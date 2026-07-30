/**
 * status.ts — מיפוי סטטוסים משותף לדשבורד ולכרטיס התיק.
 * מאחד סטטוסים לוגיים (pending_approval/sent/alert) עם סטטוסי המעקב בעברית
 * לחמש קבוצות התצוגה של הדשבורד.
 */
import { Shipment, DashboardCounts } from './api';

export type StatusKey = keyof DashboardCounts | 'other';

export const STATUS_META: { key: keyof DashboardCounts; label: string; cssVar: string }[] = [
  { key: 'alert', label: 'דורש בדיקה', cssVar: 'var(--st-alert)' },
  { key: 'awaiting_pdf', label: 'ממתין ל-PDF', cssVar: 'var(--st-awaiting-pdf)' },
  { key: 'pending_approval', label: 'ממתין לאישור', cssVar: 'var(--st-pending)' },
  { key: 'in_transit', label: 'בדרך לחיפה', cssVar: 'var(--st-transit)' },
  { key: 'arrived_haifa', label: 'הגיע לחיפה', cssVar: 'var(--st-arrived)' },
  { key: 'delivered', label: 'נמסר ללקוח', cssVar: 'var(--st-delivered)' },
];

// סדר ברירת המחדל בטבלה: התראה → ממתין ל-PDF → ממתין לאישור → בדרך → הגיע → נמסר
export const STATUS_ORDER: StatusKey[] = ['alert', 'awaiting_pdf', 'pending_approval', 'in_transit', 'arrived_haifa', 'delivered', 'other'];

export function statusKeyOf(s: Pick<Shipment, 'status'>): StatusKey {
  switch (s.status) {
    case 'ממתין ל-PDF': return 'awaiting_pdf';
    case 'pending_approval': return 'pending_approval';
    case 'alert': return 'alert';
    // "בדרך לחיפה": שוחרר/נשלח באשדוד + יצא לחיפה
    case 'sent':
    case 'שוחרר באשדוד':
    case 'יצא לחיפה': return 'in_transit';
    // "הגיע לחיפה": התקבל בחיפה
    case 'התקבל בחיפה': return 'arrived_haifa';
    case 'נמסר ללקוח': return 'delivered';
    default: return 'other';
  }
}

// תווית עברית לסטטוס הגולמי (כולל סטטוסים לוגיים באנגלית)
export function statusLabel(raw: string): string {
  return ({
    'ממתין ל-PDF': 'טיוטה מוכנה — ממתין ל-gatepass PDF',
    pending_approval: 'ממתין לאישור שליחת מייל',
    awaiting_gatepass: 'ממתין לגייטפס',
    sent: 'נשלח - ממתין לאישור העברה',
    alert: 'דורש בדיקה',
    rejected: 'נדחה',
  } as Record<string, string>)[raw] || raw || '—';
}

// סטטוסי מעקב לעדכון ידני (whitelist בצד השרת)
export const MANUAL_STATUSES = ['שוחרר באשדוד', 'יצא לחיפה', 'התקבל בחיפה', 'נמסר ללקוח'];

// מסלולי ההעברה לחיפה — מחייבים gatepass PDF לפני שליחה (עקבי עם classifier בצד השרת)
const HAIFA_TRANSFER_ROUTES = ['co_loader', 'terminal', 'direct'];

/** האם לתיק זה נדרש gatepass PDF לפני שליחה? (מסלול העברה לחיפה, ולא תזכורת) */
export function requiresGatepass(s: Pick<Shipment, 'route' | 'draft'>): boolean {
  if (s.draft?.reminder) return false;
  const route = s.draft?.route || s.route;
  return HAIFA_TRANSFER_ROUTES.includes(route);
}

/** האם ניתן לשלוח את הטיוטה כעת? (יש טיוטה, ואם נדרש PDF — הוא קיים) */
export function canSend(s: Pick<Shipment, 'route' | 'draft' | 'gatepass_pdf_path'>): boolean {
  if (!s.draft?.email) return false;
  return !requiresGatepass(s) || !!s.gatepass_pdf_path;
}

/**
 * staleHold — תוספת אוטומציה (נפרדת, ניתנת להסרה): תיק ש"נתקע" בהמתנה ל-gatepass PDF
 * (awaiting_gatepass / "ממתין ל-PDF") מעל סף שעות מוגדר מסמן פער נתונים אמיתי —
 * לא מצב חולף. מחושב מ-status_updated_at הקיים, בלי עמודה/state חדשים בשרת.
 * נגזר מ-hoursSince הקיים; נקה אוטומטית ברגע שהסטטוס משתנה (הזמן מתאפס איתו).
 */
const STALE_HOLD_STATUSES = new Set(['awaiting_gatepass', 'ממתין ל-PDF']);
export const STALE_HOLD_THRESHOLD_HOURS = 24;

export function isStaleHold(s: Pick<Shipment, 'status' | 'status_updated_at'>, thresholdHours = STALE_HOLD_THRESHOLD_HOURS): boolean {
  if (!STALE_HOLD_STATUSES.has(s.status)) return false;
  const h = hoursSince(s.status_updated_at);
  return h !== null && h >= thresholdHours;
}

/** תיאור אנושי-פעולה של הסיבה שהתיק תקוע — לא קוד שגיאה פנימי */
export function staleHoldReason(s: Pick<Shipment, 'status'>): string {
  return 'חסר gatepass PDF — לא ניתן לשלוח עד לצירופו (ידנית בכרטיס התיק, או אוטומטית כשיתקבל)';
}

/**
 * importerGapLabel — תג "נדרש להשלים יבואן" (Task 2, מצומצם 2026-07-31 לפי אישור
 * משתמש): מוצג אך ורק כשליבואן אין אף כתובת מייל (missing_fields כולל 'emails').
 * חוסר אנשי-קשר/type='unknown' אינם מספיקים יותר להצגת התג — מקור האמת היחיד הוא
 * server/src/db/importers.js's missingFields, שמחזיר כעת רק [] או ['emails'].
 * זהו תנאי תצוגה בלבד — שער האוטומציה (importerReadyForAutoSend, reportWatcher.js)
 * נפרד לגמרי ואינו קורא לפונקציה הזו.
 */
export function importerGapLabel(missing?: string[] | null): string | null {
  if (!missing || !missing.includes('emails')) return null;
  return 'נדרש להשלים יבואן';
}

/**
 * needsAttentionReason — עמוד האוטומציה, סעיף "נדרש לטיפול" (Task 4): תיאור אנושי-
 * פעולה לכל תיק שאינו בטיפול שוטף תקין. מבוסס על השדות הגולמיים הקיימים בלבד —
 * status/reason/needs_review מה-draft — לא קוד שגיאה פנימי.
 */
export function needsAttentionReason(s: Pick<Shipment, 'status' | 'reason' | 'draft'>): string | null {
  if (s.status === 'alert') {
    if (s.reason === 'unknown_co_loader') return 'קוד קו-לואדר לא מזוהה במערכת — נדרש מיפוי ב"ניהול מסופים ומשלחים"';
    if (s.reason === 'unknown_terminal') return 'מסוף שחרור לא מזוהה במערכת — נדרש מיפוי ב"ניהול מסופים ומשלחים"';
    if (s.reason === 'terminal_requires_co_loader') return 'המסוף מחייב קו-לואדר אך לא נמצא קוד — נדרש בדיקה ידנית';
    if (s.reason === 'unknown_customer') return 'לקוח לא מזוהה במערכת — נדרש מיפוי ב"ניהול יבואנים"';
    return 'סומן להתראה — נדרשת בדיקה ידנית';
  }
  if (s.status === 'awaiting_gatepass' || s.status === 'ממתין ל-PDF') {
    return 'חסר gatepass PDF — לא ניתן לשלוח עד לצירופו (ידנית בכרטיס התיק, או אוטומטית כשיתקבל)';
  }
  if (s.draft?.needs_review) {
    return 'פרטי הקשר של המסוף/קו-לואדר טרם אומתו — דורש בדיקה ב"ניהול מסופים ומשלחים"';
  }
  return null;
}

/* ---------- זמן ---------- */
export function hoursSince(iso?: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return null;
  return (Date.now() - t) / 3600000;
}

export function formatDuration(iso?: string | null): string {
  const h = hoursSince(iso);
  if (h === null) return '—';
  if (h < 1) return 'פחות משעה';
  if (h < 24) return `${Math.floor(h)} שע'`;
  return `${Math.floor(h / 24)} ימים`;
}

/** אזהרת זמן-בסטטוס: warn (כתום) / alert (אדום) לתיקים בדרך לחיפה */
export function timeSeverity(s: Pick<Shipment, 'status' | 'status_updated_at'>): '' | 'warn' | 'alert' {
  const h = hoursSince(s.status_updated_at);
  if (h === null) return '';
  if (s.status === 'יצא לחיפה' || s.status === 'sent' || s.status === 'שוחרר באשדוד') {
    if (h >= 48) return 'alert';
    if (h >= 24) return 'warn';
  } else if (s.status === 'התקבל בחיפה') {
    if (h >= 24) return 'alert';
    if (h >= 12) return 'warn';
  }
  return '';
}

// מסלולים שנחשבים "העברה לחיפה" אמיתית לצורך כלל התצוגה הבא (co_loader/terminal
// עם מוביל המשך אמיתי — לא יבואן "אוסף בעצמו", שאין לו למעשה המשך צד-שלישי).
const GENUINE_HAIFA_ROUTES = ['co_loader', 'terminal'];

/** האם התיק במסלול העברה-לחיפה אמיתי (לא prepaid/direct/alert/אוסף-בעצמו)? */
export function isGenuineHaifaTransfer(s: Pick<Shipment, 'route' | 'type'>): boolean {
  return GENUINE_HAIFA_ROUTES.includes(s.route) && s.type !== 'haifa_self';
}

/**
 * usesNonHaifaStatusDisplay — האם תיק זה כפוף לכלל התצוגה המצומצם (שני ערכים בלבד)?
 * חל על prepaid/direct/אוסף-בעצמו — לא על alert (שממילא מוצג "דורש בדיקה" תמיד),
 * לא על מסלולי העברה-לחיפה אמיתיים (co_loader/terminal עם מוביל המשך אמיתי),
 * ולא על תיק שקיבל עדכון סטטוס ידני (MANUAL_STATUSES) — עדכון אנושי תמיד גובר על
 * התווית הנגזרת מהזמן (הבאג שתוקן: הכלל המצומצם הסתיר בעבר גם עדכוני סטטוס ידניים
 * לתיקי prepaid/direct/אוסף-בעצמו, כי הוא כלל לא הביט בסטטוס הגולמי השמור).
 */
export function usesNonHaifaStatusDisplay(s: Pick<Shipment, 'route' | 'type' | 'status'>): boolean {
  if (MANUAL_STATUSES.includes(s.status)) return false;
  return s.route !== 'alert' && !isGenuineHaifaTransfer(s);
}

/**
 * nonHaifaStatusLabel — לתיקים שאינם העברת-חיפה אמיתית (prepaid/direct/אוסף-בעצמו):
 * תצוגת סטטוס מצומצמת לשני ערכים בלבד, בלי תלות בסטטוס הגולמי השמור:
 *   "שוחרר באשדוד" — פחות מ-72 שעות מאז status_updated_at (או first_seen/created_at כגיבוי)
 *   "נדרש בדיקה"   — 72 שעות ומעלה
 */
export function nonHaifaStatusLabel(s: Pick<Shipment, 'status_updated_at' | 'first_seen' | 'created_at'>): string {
  const since = s.status_updated_at || s.first_seen || s.created_at;
  const h = hoursSince(since);
  if (h !== null && h >= 72) return 'נדרש בדיקה';
  return 'שוחרר באשדוד';
}

/** dd/mm/yy מתאריך ISO (yyyy-mm-dd) — עם לוכסנים, שנה בת 2 ספרות (למשל 05/07/26) */
export function formatDateHe(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!isFinite(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)}`;
}

export function formatDateTimeHe(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!isFinite(d.getTime())) return '—';
  return d.toLocaleString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
