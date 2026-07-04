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
const { config, coLoaders, terminals, continuationCarriers, dangerousGoods } = require('../config');

const EXT = config.external_email_override; // maorfl14@gmail.com

// מפתח מנורמל (רווחים כפולים -> יחיד) למניעת אי-התאמה בגלל איכות נתונים בדוח
function normKey(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}
const terminalsNorm = {};
for (const [k, v] of Object.entries(terminals)) terminalsNorm[normKey(k)] = v;
function lookupTerminal(site) {
  return terminals[site] || terminalsNorm[normKey(site)] || null;
}

// כל כתובת חיצונית מנותבת ל-override היחיד. מיילי המערכת הפנימיים אינם עוברים כאן.
function routeExternal(emails) {
  const list = Array.isArray(emails) ? emails : emails ? [emails] : [];
  return list.length ? [EXT] : [EXT];
}

function isCaspiForwarder(forwarder) {
  if (!forwarder) return !!config.empty_forwarder_is_caspi; // ריק = כספי (הנחה הניתנת לשינוי ב-config)
  return config.caspi_forwarder_names.some((n) => forwarder.includes(n));
}

function isHazardous(rec) {
  return /^yes$/i.test(rec.hazardous) || /dangerous/i.test(rec.hazardous) || /מסוכן/.test(rec.hazardous);
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

  // 3 — co_loader: קיים Co Loader Code
  if (rec.co_loader_code) {
    const cl = coLoaders[rec.co_loader_code];
    if (!cl) {
      alerts.push({ type: 'unknown_co_loader', code: rec.co_loader_code });
      return { route: 'alert', reason: 'unknown_co_loader', code: rec.co_loader_code, alerts, needs_email: false };
    }
    return {
      route: 'co_loader',
      handler: { kind: 'co_loader', code: rec.co_loader_code, name: cl.name, gender: cl.gender, number: cl.number },
      continuation,
      recipients: { to: routeExternal(cl.emails), cc: deptCc(importer) },
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
      recipients: { to: routeExternal(term.emails), cc: deptCc(importer) },
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
  return {
    name,
    hazardous,
    emails: routeExternal(carrier.emails),
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

module.exports = { classify, isHazardous, isCaspiForwarder, resolveContinuation };
