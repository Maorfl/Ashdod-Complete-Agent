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

  // CO-LOADER / TERMINAL — פנייה לגורם המטפל + ציון מוביל ההמשך לחיפה
  const handler = decision.handler || {};
  const cont = decision.continuation || {};
  const handlerName =
    handler.contact || handler.name || handler.downloader || 'צוות המסוף';
  // מגדר/מספר של הנמען שאליו פונים (קו-לואדר מגיע עם נתונים; מסוף — ברירת מחדל זכר/רבים)
  const hg = handler.gender || 'm';
  const hn = handler.number || 'p';

  const hazLine = cont.hazardous ? ' (מטען מסוכן)' : '';
  const body = [
    `${handlerName}, שלום רב,`,
    '',
    `משלוח של ${rec.customer_name} (תיק ${rec.file_number}) שוחרר בנמל אשדוד${hazLine}.`,
    `${g.thanks(hg, hn)} בהעברה לחיפה.`,
    cont.name ? `מוביל ההמשך לחיפה: ${cont.name}. נעדכן בהגעה.` : 'נעדכן בהגעה לחיפה.',
    ...signature(),
  ].join('\n');

  return { ...base, body };
}

// מצב 2 — תגובת הגעה לחיפה (נשלחת רק אחרי owns_file)
function composeArrival(record, terminalKey) {
  const from = config.sender_mailbox;
  const place = { goldbond: 'קונטרם חיפה', overseas: 'אוברסיז חיפה', sme: 'סמא חיפה' }[terminalKey] || 'חיפה';
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
function composeReminder(record) {
  const from = config.sender_mailbox;
  const cc = [...(config.always_cc || [])];
  const dept = record.department && config.departments?.[record.department];
  if (dept?.email && !cc.includes(dept.email)) cc.push(dept.email);

  const cont = record.continuation ? ` (מוביל המשך: ${record.continuation})` : '';
  return {
    from,
    to: [config.external_email_override],
    cc,
    subject: `RE: C/ ${record.customer_name || ''} FILE NO/ ${record.file_number} — תזכורת`,
    body: [
      'שלום רב,',
      '',
      `תזכורת בנוגע למשלוח של ${record.customer_name || ''} (תיק ${record.file_number})${cont}.`,
      'טרם התקבל עדכון על התקדמות הטיפול — נודה לעדכון סטטוס בהקדם.',
      ...signature(),
    ].join('\n'),
  };
}

module.exports = { composeRelease, composeArrival, composeReminder, subjectLine };
