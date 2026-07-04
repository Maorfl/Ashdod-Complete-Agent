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
  { key: 'released_ashdod', label: 'שוחרר באשדוד', cssVar: 'var(--st-transit)' },
  { key: 'to_haifa', label: 'בדרך / הגיע לחיפה', cssVar: 'var(--st-arrived)' },
  { key: 'delivered', label: 'נמסר ללקוח', cssVar: 'var(--st-delivered)' },
];

// סדר ברירת המחדל בטבלה: התראה → ממתין → שוחרר → בחיפה → נמסר
export const STATUS_ORDER: StatusKey[] = ['alert', 'pending_approval', 'released_ashdod', 'to_haifa', 'delivered', 'other'];

export function statusKeyOf(s: Pick<Shipment, 'status'>): StatusKey {
  switch (s.status) {
    case 'pending_approval': return 'pending_approval';
    case 'alert': return 'alert';
    case 'sent':
    case 'שוחרר באשדוד': return 'released_ashdod';
    case 'יצא לחיפה':
    case 'התקבל בחיפה': return 'to_haifa';
    case 'נמסר ללקוח': return 'delivered';
    default: return 'other';
  }
}

// תווית עברית לסטטוס הגולמי (כולל סטטוסים לוגיים באנגלית)
export function statusLabel(raw: string): string {
  return ({
    pending_approval: 'ממתין לאישור',
    sent: 'נשלח — שוחרר באשדוד',
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

/** dd/mm/yyyy מתאריך ISO (yyyy-mm-dd) — עם לוכסנים, לפי האפיון */
export function formatDateHe(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!isFinite(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function formatDateTimeHe(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!isFinite(d.getTime())) return '—';
  return d.toLocaleString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
