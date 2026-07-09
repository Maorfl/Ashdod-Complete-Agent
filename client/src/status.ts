/**
 * status.ts — מיפוי סטטוסים משותף לדשבורד ולכרטיס התיק.
 * מאחד סטטוסים לוגיים (pending_approval/sent/alert) עם סטטוסי המעקב בעברית
 * לחמש קבוצות התצוגה של הדשבורד.
 */
import { Shipment, DashboardCounts } from './api';

export type StatusKey = keyof DashboardCounts | 'other';

export const STATUS_META: { key: keyof DashboardCounts; label: string; cssVar: string }[] = [
  { key: 'alert', label: 'דורש בדיקה', cssVar: 'var(--st-alert)' },
  { key: 'pending_approval', label: 'ממתין לאישור', cssVar: 'var(--st-pending)' },
  { key: 'in_transit', label: 'בדרך לחיפה', cssVar: 'var(--st-transit)' },
  { key: 'arrived_haifa', label: 'הגיע לחיפה', cssVar: 'var(--st-arrived)' },
  { key: 'delivered', label: 'נמסר ללקוח', cssVar: 'var(--st-delivered)' },
];

// סדר ברירת המחדל בטבלה: התראה → ממתין → בדרך → הגיע → נמסר
export const STATUS_ORDER: StatusKey[] = ['alert', 'pending_approval', 'in_transit', 'arrived_haifa', 'delivered', 'other'];

export function statusKeyOf(s: Pick<Shipment, 'status'>): StatusKey {
  switch (s.status) {
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
    pending_approval: 'ממתין לאישור שליחת מייל',
    awaiting_gatepass: 'ממתין לגייטפס',
    sent: 'נשלח - ממתין לאישור העברה',
    alert: 'דורש בדיקה',
    rejected: 'נדחה',
  } as Record<string, string>)[raw] || raw || '—';
}

// סטטוסי מעקב לעדכון ידני (whitelist בצד השרת)
export const MANUAL_STATUSES = ['שוחרר באשדוד', 'יצא לחיפה', 'התקבל בחיפה', 'נמסר ללקוח'];

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
