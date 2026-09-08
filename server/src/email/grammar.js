/**
 * email/grammar.js — דקדוק עברי: התאמת הפנייה למגדר ולמספר של הנמען.
 * gender: 'm' | 'f' ; number: 's' (יחיד) | 'p' (רבים)
 *
 * טבלת ההתאמה (לפי האפיון):
 *   יחיד (ז/נ)  -> אודה לטיפולך
 *   זכר רבים    -> אודה לטיפולכם
 *   נקבה רבות   -> אודה לטיפולכן
 * דוגמאות: אושן לינק (f/p) -> טיפולכן ; איזי קונסול (m/p) -> טיפולכם
 */

// סיומת הפנייה בלבד: ך / כם / כן
function suffix(gender, number) {
  if (number === 'p') return gender === 'f' ? 'כן' : 'כם';
  return 'ך'; // יחיד — זהה לשני המינים
}

function thanks(gender, number) {
  return `אודה לטיפול${suffix(gender, number)}`;
}

function approval(gender, number) {
  return `בבקשה אישור${suffix(gender, number)}`;
}

// "שלך / שלכם / שלכן"
function yours(gender, number) {
  if (number === 'p') return gender === 'f' ? 'שלכן' : 'שלכם';
  return 'שלך';
}

function address(contactOrName) {
  return contactOrName; // "צוות אושן לינק" / "יוסי" / "אתי" — מנוסח מראש ב-config
}

/**
 * displayName — הסרת סיומת תאגידית מסופית לצורך *תצוגה בלבד*.
 * הרשומות ב-co_loaders.json/terminals.json שומרות את השם הרשום המלא
 * ("אושן לינק בע\"מ"), אך משפט הפנייה "צוות {שם}" צריך את השם בלי הסיומת.
 * זו פונקציית רינדור — לעולם לא נכתב הערך המקוצר בחזרה לקונפיג/DB.
 *
 * מסירה רק סיומת *מסופית* וכמילה שלמה: בע"מ על כל וריאציות הגרשיים
 * (" / ״ U+05F4 / ' / ׳ U+05F3) והצורה הלא-מנוקדת בעמ, וכן LTD/LTD./Ltd.
 * שאר השם נשאר כפי שהוא, כולל סוגריים: "טוטל קרגו (טי.סי.אל) בע\"מ" -> "טוטל קרגו (טי.סי.אל)".
 * פסיק/מקף/רווח שנותרו תלויים בסוף מנוקים.
 */
const CORP_SUFFIX_RE = /(?:[,\-–]\s*)?(?:בע(?:["״'׳])?מ|LTD\.?|Ltd\.?)\s*$/i;
function displayName(name) {
  let out = String(name == null ? '' : name).trim();
  if (!out) return out;
  const stripped = out.replace(CORP_SUFFIX_RE, '').replace(/[\s,\-–]+$/, '').trim();
  // לא מחזירים מחרוזת ריקה — שם שכולו סיומת נשאר כפי שהוא
  return stripped || out;
}

/**
 * teamAddress — "צוות {שם}" עם הסרת הסיומת התאגידית, ובלי לשכפל "צוות"
 * אם השם שהגיע כבר מנוסח כך (למשל contact = "צוות אושן לינק" בקונפיג).
 */
function teamAddress(name, fallback) {
  const clean = displayName(name) || fallback;
  return /^צוות\s/.test(clean) ? clean : `צוות ${clean}`;
}

module.exports = { thanks, approval, yours, suffix, address, displayName, teamAddress };
