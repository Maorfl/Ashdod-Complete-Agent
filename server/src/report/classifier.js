/**
 * report/classifier.js — עץ ההחלטה הדטרמיניסטי.
 * מקבל רשומת דוח מנורמלת + רשומת יבואן (או null), ומחזיר החלטת ניתוב מלאה.
 * אפס תלות ב-LLM — לוגיקה קשיחה בלבד.
 *
 * סדר המסלולים (first match wins):
 *   1. no_op    — Customs Station Code ≠ 2 (לא אשדוד)
 *   2. prepaid  — Inter. Forwarder אינו כספי (היבואן מטפל ישירות)
 *   3. co_loader— קיים Co Loader Code (ניתוב למוביל המאחד)
 *   4. terminal — אין קוד קו-לואדר → ניתוב למסוף לפי Cust. Stor. Site Des
 *   5. direct   — יבואן מסוג direct → שחרור ישיר
 *   6. alert    — קוד קו-לואדר/מסוף לא מזוהה → בדיקה ידנית, לא שולחים
 *
 * כל נמען חיצוני ב-To מנותב דרך external_email_override.
 */
const { config, continuationCarriers, dangerousGoods } = require('../config');
const contacts = require('../db/contacts'); // מקור אמת יחיד ל-CO-LOADERS/מסופים + חיפוש לפי שם

const EXT = config.external_email_override; // maorfl14@gmail.com

function lookupTerminal(site) {
  return contacts.getTerminal(site);
}

// prepaid/direct + מובילי המשך: כל נמען חיצוני מנותב ל-override היחיד (כלל הבטיחות נשמר).
function routeExternal(emails) {
  const list = Array.isArray(emails) ? emails : emails ? [emails] : [];
  return list.length ? [EXT] : [EXT];
}

// מסלולי ההעברה לחיפה (co_loader/terminal) — נמענים אמיתיים (אושר במפורש 2026-07-07):
// מאחד את מיילי המסוף/קו-לואדר, מיילי "מבצע העברה לחיפה" לפי שם, ומיילי היבואן —
// מסונן ל-@ ומדודפליקט. אם לא נמצאה אף כתובת אמיתית — נפילה ל-override (לא To ריק).
// השליחה עצמה עדיין דורשת אישור אנושי; ה-CC הפנימי נשאר כפי שהוא.
function realTo(...emailGroups) {
  const seen = new Set();
  const out = [];
  for (const g of emailGroups) {
    for (const e of (Array.isArray(g) ? g : g ? [g] : [])) {
      const v = String(e || '').trim();
      if (!v.includes('@')) continue;
      const k = v.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k); out.push(v);
    }
  }
  return out.length ? out : [EXT];
}

function realImporterEmails(importer) {
  return (importer && Array.isArray(importer.emails)) ? importer.emails : [];
}

function isCaspiForwarder(forwarder) {
  if (!forwarder) return !!config.empty_forwarder_is_caspi; // ריק = כספי (הנחה הניתנת לשינוי ב-config)
  return config.caspi_forwarder_names.some((n) => forwarder.includes(n));
}

function isHazardous(rec) {
  return /^yes$/i.test(rec.hazardous) || /dangerous/i.test(rec.hazardous) || /מסוכן/.test(rec.hazardous);
}

// "נמל אשדוד"/"נמל הדרום" = הנמל עצמו (לא מסוף) — שחרור ישיר בנמל אינו "העברה לחיפה".
const PORT_SITES = new Set(['נמל אשדוד', 'נמל הדרום']);
// מסלולי "העברה לחיפה" האמיתיים — היחידים שזכאים לטיוטת מייל (וממותנים ב-gatepass PDF
// בשלב השליחה). prepaid לעולם אינו מקבל מייל; alert/no_op בבדיקה ידנית/לא נשמרים.
const HAIFA_TRANSFER_ROUTES = new Set(['co_loader', 'terminal', 'direct']);

function isPortSite(site) {
  return PORT_SITES.has(String(site || '').trim());
}

// האם למסלול זה נדרש gatepass PDF לפני שליחה? (נאכף ב-routes/approvals + בקליינט)
function requiresGatepass(route) {
  return HAIFA_TRANSFER_ROUTES.has(route);
}

/**
 * isHaifaTransfer — האם התיק הוא "העברה לחיפה" אמיתית שזכאית לטיוטת מייל.
 * אמת רק כשכל התנאים מתקיימים:
 *   - שוחרר באשדוד (Customs Station Code = 2)
 *   - FCL/LCL = LCL (רק LCL עובר העברה לחיפה; FCL נספר לתצוגה בלבד)
 *   - מסוף שחרור (site_des) קיים ואינו הנמל עצמו (נמל אשדוד/נמל הדרום)
 *   - המסלול הוא co_loader/terminal/direct (לא prepaid/alert/no_op)
 * הימצאות ה-gatepass PDF אינה חלק מכאן — היא נאכפת בשלב השליחה (routes/approvals),
 * לפי החלטת המשתמש 2026-07-13 (חוסמים שליחה בלי PDF, לא בונים טיוטה מאוחר).
 */
function isHaifaTransfer(rec, decision) {
  if (!decision || !HAIFA_TRANSFER_ROUTES.has(decision.route)) return false;
  if (String(rec.customs_station_code) !== String(config.relevant_customs_station_code)) return false;
  const lclTarget = config.report_scope?.fcl_lcl || 'LCL';
  if (String(rec.fcl_lcl || '').trim() !== lclTarget) return false;
  const site = String(rec.site_des || '').trim();
  if (!site || isPortSite(site)) return false;
  return true;
}

/**
 * transferPerformer — "מבצע העברה לחיפה": מי מבצע בפועל את ההעברה אשדוד→חיפה.
 * מושג נפרד ממוביל ההמשך בחיפה (continuation). סדר עדיפות מדויק:
 *   1. Co Loader Name קיים → הקו-לואדר.
 *   2. אחרת, Inter. Forwarder קיים ואינו כספי (isCaspiForwarder) → המשלח.
 *   3. אחרת (כספי / ריק=כספי) → המסוף (Cust. Stor. Site Des).
 */
function transferPerformer(rec) {
  const coLoader = String(rec.co_loader_name || '').trim();
  if (coLoader) return coLoader;
  const fwd = String(rec.forwarder || '').trim();
  if (fwd && !isCaspiForwarder(fwd)) return fwd;
  return String(rec.site_des || '').trim();
}

/**
 * @param rec רשומת דוח מנורמלת (reader.js)
 * @param importer רשומת יבואן (או null אם לא נמצא)
 * @returns {route, reason, recipients:{to,cc}, continuation, handler, alerts, needs_email, needs_review}
 */
function classify(rec, importer) {
  const alerts = [];

  // 1 — no_op: רק אשדוד (קוד 2)
  if (rec.customs_station_code !== String(config.relevant_customs_station_code)) {
    return { route: 'no_op', reason: 'not_ashdod', needs_email: false };
  }

  // 2 — prepaid: משלח חיצוני (לא כספי) → היבואן מטפל ישירות
  if (!isCaspiForwarder(rec.forwarder)) {
    return {
      route: 'prepaid',
      reason: 'external_forwarder',
      forwarder: rec.forwarder,
      recipients: { to: routeExternal(importerEmails(importer)), cc: deptCc(importer) },
      needs_email: true,
    };
  }

  // מוביל המשך + כלל חומר מסוכן (משותף ל-co_loader/terminal/direct)
  const continuation = resolveContinuation(rec, importer, alerts);

  // האם ליבואן הזה יש בפועל מוביל המשך מוגדר? (2026-07-15, אישור משתמש) כשאין —
  // resolveContinuation עדיין נופל לברירת המחדל (גולד בונד/סמא) לצורך המשך הלוגיקה
  // הפנימית, אך זו נפילה טכנית בלבד ואסור שתוסיף נמען אמיתי לרשימת ה-To: אין להוסיף
  // "מוביל המשך" ל-recipients כשליבואן אין כזה בפועל. הערה: composer.js כבר מטפל
  // נכון בגוף המייל למקרה הזה (isSelf — כשאין cont_general, נעשה שימוש בשם/אנשי-קשר
  // הלקוח במקום "צוות {מוביל}"), כך שאין צורך בשינוי שם ב-composer.
  const importerHasContinuation = !!(importer && (
    String(importer.cont_general || '').trim() ||
    (Array.isArray(importer.cont_general_emails) && importer.cont_general_emails.length)
  ));
  const continuationRecipientEmails = importerHasContinuation ? continuation.rawEmails : [];

  // "מבצע העברה לחיפה" ומייליו לפי שם (Task 1) — כולל ישות ללא קוד בדוח (למשל MASTER CARGO)
  const performer = transferPerformer(rec);
  const performerEmails = contacts.emailsFor(performer);

  // 3 — co_loader: קיים Co Loader Code
  if (rec.co_loader_code) {
    const cl = contacts.getCoLoaderByCode(rec.co_loader_code);
    if (!cl) {
      alerts.push({ type: 'unknown_co_loader', code: rec.co_loader_code });
      return { route: 'alert', reason: 'unknown_co_loader', code: rec.co_loader_code, alerts, needs_email: false };
    }
    return {
      route: 'co_loader',
      handler: { kind: 'co_loader', code: rec.co_loader_code, name: cl.name, gender: cl.gender, number: cl.number },
      continuation,
      // נמענים אמיתיים (Task 4): קו-לואדר + מבצע-לפי-שם + היבואן + מוביל ההמשך לחיפה,
      // רק כשליבואן יש בפועל מוביל המשך מוגדר (2026-07-14/15, אישור משתמש)
      recipients: { to: realTo(cl.emails, performerEmails, realImporterEmails(importer), continuationRecipientEmails), cc: deptCc(importer) },
      needs_review: !!cl.needs_review,
      alerts,
      needs_email: true,
    };
  }

  // 4 — terminal: אין קו-לואדר → ניתוב לפי Cust. Stor. Site Des
  const term = lookupTerminal(rec.site_des);
  if (term) {
    if (term.always_with_coloader) {
      alerts.push({ type: 'masof207_without_coloader', file: rec.file_number });
      return { route: 'alert', reason: 'terminal_requires_co_loader', site: rec.site_des, alerts, needs_email: false };
    }
    return {
      route: 'terminal',
      handler: { kind: 'terminal', site: rec.site_des, key: term.key, downloader: term.downloader },
      continuation,
      // נמענים אמיתיים (Task 4): מסוף + מבצע-לפי-שם + היבואן + מוביל ההמשך לחיפה,
      // רק כשליבואן יש בפועל מוביל המשך מוגדר (2026-07-14/15, אישור משתמש)
      recipients: { to: realTo(term.emails, performerEmails, realImporterEmails(importer), continuationRecipientEmails), cc: deptCc(importer) },
      needs_review: !!term.needs_review,
      alerts,
      needs_email: true,
    };
  }

  // 5 — direct: יבואן מסוג direct → שחרור ישיר ללקוח
  if (importer && importer.type === 'direct') {
    return {
      route: 'direct',
      handler: { kind: 'direct' },
      continuation,
      recipients: { to: routeExternal(importerEmails(importer)), cc: deptCc(importer) },
      alerts,
      needs_email: true,
    };
  }

  // 6 — alert: מסוף לא מזוהה (ולא direct) → בדיקה ידנית
  alerts.push({ type: 'unknown_terminal', site: rec.site_des });
  return { route: 'alert', reason: 'unknown_terminal', site: rec.site_des, alerts, needs_email: false };
}

// מוביל המשך לחיפה + override חומר מסוכן (גולד בונד → סמא)
function resolveContinuation(rec, importer, alerts) {
  const hazardous = isHazardous(rec);
  let name = (importer && importer.cont_general) || dangerousGoods.default_carrier;

  // כלל חומ"ס: גולד בונד אינה מורידה חומר מסוכן. אם המוביל הוא ברירת המחדל (גולד בונד)
  // והמטען מסוכן — מחליפים אוטומטית לסמא, ללא תלות בהגדרת היבואן.
  if (hazardous && name === dangerousGoods.default_carrier) {
    name = dangerousGoods.override_when_hazardous; // סמא
  }

  if (!importer) alerts.push({ type: 'unknown_customer', customer: rec.customer_name });
  const carrier = continuationCarriers[name] || {};
  const rawEmails = Array.isArray(carrier.emails) ? carrier.emails : (carrier.emails ? [carrier.emails] : []);
  return {
    name,
    hazardous,
    emails: routeExternal(carrier.emails),
    rawEmails, // כתובות המוביל לפני override — למיזוג ב-recipients.to של co_loader/terminal (ראו realTo)
    gender: carrier.gender || 'm',
    number: carrier.number || 'p',
    contact: carrier.contact || '',
  };
}

function importerEmails(importer) {
  return importer && importer.emails && importer.emails.length ? importer.emails : [EXT];
}

// CC פנימי בלבד — נשמר כפי שהוא (לא עובר override): ashdod@ + מייל המחלקה
function deptCc(importer) {
  const cc = [...(config.always_cc || [])];
  const dept = importer && importer.department;
  if (dept && config.departments[dept]) cc.push(config.departments[dept].email);
  return uniq(cc);
}

function uniq(arr) {
  return [...new Set((arr || []).filter(Boolean))];
}

module.exports = {
  classify, isHazardous, isCaspiForwarder, resolveContinuation, transferPerformer,
  isHaifaTransfer, requiresGatepass, isPortSite, HAIFA_TRANSFER_ROUTES,
};
