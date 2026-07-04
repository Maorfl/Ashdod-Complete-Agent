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
  return `אבקש את אישור${suffix(gender, number)}`;
}

// "שלך / שלכם / שלכן"
function yours(gender, number) {
  if (number === 'p') return gender === 'f' ? 'שלכן' : 'שלכם';
  return 'שלך';
}

function address(contactOrName) {
  return contactOrName; // "צוות אושן לינק" / "יוסי" / "אתי" — מנוסח מראש ב-config
}

module.exports = { thanks, approval, yours, suffix, address };
