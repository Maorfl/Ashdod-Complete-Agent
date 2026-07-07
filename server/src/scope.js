/**
 * scope.js — מקור אמת יחיד ל-whitelist לקוחות ההעברה לחיפה (CUS1).
 *
 * מוגדר פעם אחת ב-config.report_scope.customer_whitelist ונצרך גם ב-ingestion
 * (reportWatcher.inScope) וגם בשכבת ההגשה/תצוגה (routes/shipments + approvals),
 * כדי שלא יווצרו שתי הגדרות שעלולות לצאת מסנכרון. הבאג הקודם נבע בדיוק מכך
 * שנקודת האכיפה היחידה (inScope) לא חוברה — לכן אכיפה בשתי שכבות (defense in depth).
 *
 * הנרמול תואם את db/importers.findByName: trim + כיווץ רווחים + lowercase + הסרת
 * נקודה בסוף (למשל "TELDOR ... LTD." == "TELDOR ... LTD").
 */
const { config } = require('./config');

function normCust(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/\.+$/, '').trim();
}

let _set = null;
function whitelistSet() {
  if (_set) return _set;
  const names = (config.report_scope && config.report_scope.customer_whitelist) || [];
  _set = new Set(names.map(normCust));
  return _set;
}

// האם הלקוח מותר תחת CUS1? כשה-whitelist ריק — אין סינון (מחזיר true).
function isWhitelisted(customerName) {
  const wl = whitelistSet();
  return wl.size ? wl.has(normCust(customerName)) : true;
}

module.exports = { normCust, whitelistSet, isWhitelisted };
