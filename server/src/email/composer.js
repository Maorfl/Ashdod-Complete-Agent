/**
 * email/composer.js — בניית טיוטת המייל היוצא לפי החלטת הסיווג.
 * מחזיר { from, to, cc, subject, body, route, needs_review } — לא נשלח עד אישור מחלקה.
 *
 * השולח וה-CC הפנימיים נשמרים כפי שהם. הנמענים החיצוניים כבר עברו override במסווג.
 */
const { config } = require('../config');
const g = require('./grammar');

function subjectLine(rec) {
  return `C/ ${rec.customer_name} FILE NO/ ${rec.file_number}`;
}

function signature() {
  return ['', 'בברכה,', 'צוות כספי אשדוד'];
}

// מיפוי משותף: מוביל המשך / מפתח מסוף → שם יעד המשך בחיפה.
// מקבל גם מפתח (goldbond/overseas/sme) וגם שם מוביל בעברית (גולד בונד/סמא/סדצקי).
const HAIFA_TERMINAL_BY_KEY = { goldbond: 'קונטרם חיפה', overseas: 'אוברסיז חיפה', sme: 'סמא חיפה' };
const CARRIER_NAME_TO_KEY = { 'גולד בונד': 'goldbond', 'סמא': 'sme', 'סדצקי': 'sedecky' };
function haifaTerminalName(carrierOrKey) {
  if (!carrierOrKey) return 'חיפה';
  if (HAIFA_TERMINAL_BY_KEY[carrierOrKey]) return HAIFA_TERMINAL_BY_KEY[carrierOrKey];
  const key = CARRIER_NAME_TO_KEY[carrierOrKey];
  return (key && HAIFA_TERMINAL_BY_KEY[key]) || `${carrierOrKey} חיפה`;
}

// עטיפת HTML מינימלית (Arial 12pt, RTL) — נלווית ל-body הטקסטואלי, לשליחה עתידית.
function toBodyHtml(text) {
  const esc = String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
  return `<div style="font-family: Arial; font-size: 12pt; direction: rtl; text-align: right;">${esc}</div>`;
}

function composeRelease(rec, decision, importer) {
  const from = config.sender_mailbox; // ashdod.agent@h-caspi.co.il — נשמר
  const subject = subjectLine(rec);
  const to = decision.recipients?.to || [];
  const cc = decision.recipients?.cc || [];
  const base = { from, to, cc, subject, route: decision.route, needs_review: !!decision.needs_review };

  // PREPAID — מייל קצר למשלח החיצוני; היבואן/משלח מטפלים בהמשך
  if (decision.route === 'prepaid') {
    return {
      ...base,
      body: [
        'שלום רב,',
        '',
        `משלוח של ${rec.customer_name} (תיק ${rec.file_number}) שוחרר בנמל אשדוד.`,
        `התיק מנוהל כ-PREPAID על ידי ${decision.forwarder || 'המשלח'} — נא להמשיך בהובלה לחיפה.`,
        'מצורפים תעודת משלוח וגייטפס (ככל שזמינים).',
        ...signature(),
      ].join('\n'),
    };
  }

  // DIRECT — עדכון ללקוח/יבואן בלבד
  if (decision.route === 'direct') {
    return {
      ...base,
      body: [
        'שלום רב,',
        '',
        `משלוח של ${rec.customer_name} (תיק ${rec.file_number}) שוחרר בנמל אשדוד.`,
        'נא לתאם איסוף/המשך טיפול מול היבואן.',
        ...signature(),
      ].join('\n'),
    };
  }

  // CO-LOADER / TERMINAL — מייל "העברה לחיפה" לפי נוהל כתוב (פורמט מדויק).
  const handler = decision.handler || {};
  const cont = decision.continuation || {};
  // שם הגורם המטפל באשדוד (ללא "צוות" — מתווסף בתבנית). ברירת מחדל: "המסוף".
  const handlerName = handler.contact || handler.name || handler.downloader || 'המסוף';
  // מגדר/מספר של הנמען שאליו פונים (קו-לואדר מגיע עם נתונים; מסוף — ברירת מחדל זכר/רבים)
  const hg = handler.gender || 'm';
  const hn = handler.number || 'p';

  // נושא לפי הנוהל: "{לקוח} \ {תיק} – העברה לחיפה"
  const transferSubject = `${rec.customer_name} \\ ${rec.file_number} – העברה לחיפה`;

  // שורת שחרור — הליבה קבועה; סיומת חומ"ס רק כשרלוונטי, בלי לשבור את הליטרל
  const releaseLine = cont.hazardous ? 'משלוח שוחרר באשדוד (מטען מסוכן)' : 'משלוח שוחרר באשדוד';

  // שורת המשך + שורת זמינות — לפי סוג היבואן (haifa_self מול המשך ע"י מוביל)
  const haifaName = haifaTerminalName(cont.name);
  const isSelf = importer && importer.type === 'haifa_self';
  const continuationLine = isSelf
    ? `${rec.customer_name}, משלוח יגיע ל${haifaName}`
    : `צוות ${cont.name || 'מוביל ההמשך'}, משלוח יגיע ל${haifaName}`;
  const availabilityLine = isSelf ? 'נעדכן בזמינות.' : 'המשך שלכם. נעדכן בזמינות.';

  const body = [
    releaseLine,
    `צוות ${handlerName}, ${g.thanks(hg, hn)} בהעברה לחיפה`,
    g.approval(hg, hn),
    continuationLine,
    availabilityLine,
    'מצ"ב ניירת.',
    '',
    'בברכה,',
    'צוות כספי',
  ].join('\n');

  // CC למסלולים אלה בלבד: מייל המחלקה בלבד — ללא ashdod@ (config.always_cc)
  const transferCc = cc.filter((x) => !(config.always_cc || []).includes(x));

  return { ...base, cc: transferCc, subject: transferSubject, body, bodyHtml: toBodyHtml(body) };
}

// מצב 2 — תגובת הגעה לחיפה (נשלחת רק אחרי owns_file)
function composeArrival(record, terminalKey) {
  const from = config.sender_mailbox;
  const place = haifaTerminalName(terminalKey);
  const type = record.type || 'haifa_cont';
  const cont = record.continuation || '';

  const line = type === 'haifa_cont'
    ? `המשלוח נקלט ב${place}. ${cont ? cont + ', ' : ''}המשך הטיפול שלכם — ניתן לאסוף.`
    : `המשלוח הגיע ל${place}, ניתן למשוך את המטען.`;

  return {
    from,
    to: [config.external_email_override],
    cc: [...(config.always_cc || [])],
    subject: `RE: C/ ${record.customer_name || record.customer || ''} FILE NO/ ${record.file_number}`,
    body: ['שלום רב,', '', line, ...signature()].join('\n'),
  };
}

/**
 * תזכורת ידנית מהדשבורד — טיוטה בלבד, חוזרת לתור האישורים (human-in-the-loop).
 * ה-To החיצוני מנותב דרך external_email_override; ה-CC פנימי בלבד (ashdod@ + מחלקה).
 */
function composeReminder(record, notes) {
  const from = config.sender_mailbox;
  const cc = [...(config.always_cc || [])];
  const dept = record.department && config.departments?.[record.department];
  if (dept?.email && !cc.includes(dept.email)) cc.push(dept.email);

  const cont = record.continuation ? ` (מוביל המשך: ${record.continuation})` : '';
  const bodyLines = [
    'שלום רב,',
    '',
    `תזכורת בנוגע למשלוח של ${record.customer_name || ''} (תיק ${record.file_number})${cont}.`,
    'טרם התקבל עדכון על התקדמות הטיפול — נודה לעדכון סטטוס בהקדם.',
  ];
  if (notes) {
    bodyLines.push('', `הערת מחלקה: ${notes}`);
  }
  bodyLines.push(...signature());

  return {
    from,
    to: [config.external_email_override],
    cc,
    subject: `RE: C/ ${record.customer_name || ''} FILE NO/ ${record.file_number} — תזכורת`,
    body: bodyLines.join('\n'),
  };
}

module.exports = { composeRelease, composeArrival, composeReminder, subjectLine, haifaTerminalName, toBodyHtml };
