/**
 * FileModal — כרטיס תיק: פרטים מלאים, ציר-זמן היסטוריה, טיוטת מייל ופעולות.
 * נסגר ב-Escape ובלחיצה על הרקע. הפעולות זהות לאלה שבטבלת הדשבורד.
 */
import { useEffect, useState } from 'react';
import { api, Shipment, HistoryEntry } from '../api';
import { statusKeyOf, statusLabel, STATUS_META, MANUAL_STATUSES, formatDateHe, formatDateTimeHe } from '../status';
import { useToast } from './Toasts';

const ROUTE_LABELS: Record<string, string> = {
  co_loader: 'CO-LOADER', terminal: 'מסוף', prepaid: 'PREPAID', direct: 'ישיר', alert: 'התראה', sent: 'נשלח', reminder: 'תזכורת',
};

export default function FileModal({ item, onClose, onChanged }: {
  item: Shipment;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [statusPick, setStatusPick] = useState('');

  useEffect(() => {
    api.history(item.file_number).then(setHistory).catch(() => setHistory([]));
  }, [item.file_number]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const key = statusKeyOf(item);
  const meta = STATUS_META.find((m) => m.key === key);
  const email = item.draft?.email;

  async function deliver() {
    if (!confirm(`לסמן תיק ${item.file_number} כנמסר ללקוח?`)) return;
    try {
      await api.updateStatus(item.file_number, 'נמסר ללקוח');
      toast(`תיק ${item.file_number} סומן כנמסר ✓`, 'success');
      onChanged(); onClose();
    } catch (e: any) { toast(e.message, 'error'); }
  }

  async function changeStatus(status: string) {
    if (!status) return;
    if (!confirm(`לעדכן את תיק ${item.file_number} לסטטוס "${status}"?`)) { setStatusPick(''); return; }
    try {
      await api.updateStatus(item.file_number, status);
      toast(`הסטטוס עודכן ל"${status}" ✓`, 'success');
      onChanged(); onClose();
    } catch (e: any) { toast(e.message, 'error'); setStatusPick(''); }
  }

  async function remind() {
    if (!confirm(`ליצור תזכורת לתיק ${item.file_number}? הטיוטה תמתין לאישור — לא יישלח מייל.`)) return;
    try {
      await api.createReminder(item.file_number);
      toast('טיוטת תזכורת נוצרה וממתינה לאישור ✓', 'success');
      onChanged(); onClose();
    } catch (e: any) { toast(e.message, 'error'); }
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={`כרטיס תיק ${item.file_number}`}>
        <div className="modal-head">
          <div>
            <span className="mono file-no">{item.file_number}</span>
            <span className="modal-cust">{item.customer_name || '—'}</span>
          </div>
          <button className="x" onClick={onClose} aria-label="סגירה">×</button>
        </div>

        <div className="modal-body">
          <table className="details-table">
            <tbody>
              <tr><th>מספר תיק</th><td className="mono">{item.file_number}</td></tr>
              <tr><th>לקוח</th><td>{item.customer_name || '—'}</td></tr>
              <tr><th>סטטוס נוכחי</th><td>
                <span className="st-badge" style={{ ['--c' as any]: meta?.cssVar || 'var(--muted)' }}>{statusLabel(item.status)}</span>
              </td></tr>
              <tr><th>תאריך שחרור</th><td className="mono">{formatDateHe(item.release_date)}</td></tr>
              <tr><th>עדכון סטטוס אחרון</th><td className="mono">{formatDateTimeHe(item.status_updated_at)}</td></tr>
              <tr><th>מסלול</th><td>{ROUTE_LABELS[item.route] || item.route || '—'}</td></tr>
              <tr><th>מוביל המשך</th><td>{item.continuation || '—'}</td></tr>
              <tr><th>קוד קו-לואדר</th><td className="mono">{item.co_loader_code || '—'}</td></tr>
              <tr><th>מחלקה / סוכן</th><td>
                {item.department ? item.department.toUpperCase() : '—'}
                {item.agent_name ? ` · ${item.agent_name}` : ''}
              </td></tr>
              <tr><th>חומר מסוכן</th><td>{item.hazardous === 'Yes' ? '⚠ כן' : 'לא'}</td></tr>
              {item.notes && <tr><th>הערות</th><td>{item.notes}</td></tr>}
            </tbody>
          </table>

          <h4 className="modal-sec">היסטוריית סטטוסים</h4>
          {history === null && <div className="empty small">טוען היסטוריה…</div>}
          {history !== null && history.length === 0 && <div className="empty small">אין רשומות היסטוריה לתיק זה.</div>}
          {history !== null && history.length > 0 && (
            <ol className="timeline">
              {history.map((h) => (
                <li key={h.id}>
                  <div className="tl-dot" />
                  <div className="tl-body">
                    <div className="tl-status">{statusLabel(h.status)}</div>
                    <div className="tl-time mono">{formatDateTimeHe(h.changed_at)}</div>
                    {h.notes && <div className="tl-notes">{h.notes}</div>}
                  </div>
                </li>
              ))}
            </ol>
          )}

          {email && (
            <>
              <h4 className="modal-sec">טיוטת מייל (ממתינה לאישור)</h4>
              <div className="email-preview">
                <div><span className="k">מאת: </span><span className="mono">{email.from}</span></div>
                <div><span className="k">אל: </span><span className="mono">{email.to.join(', ')}</span></div>
                <div><span className="k">עותק: </span><span className="mono">{email.cc.join(', ')}</span></div>
                <div><span className="k">נושא: </span>{email.subject}</div>
                <pre>{email.body}</pre>
              </div>
            </>
          )}
        </div>

        <div className="modal-foot">
          {item.status !== 'נמסר ללקוח' && (
            <button className="btn primary" onClick={deliver}>✅ סימון כנמסר</button>
          )}
          <select
            className="status-pick"
            value={statusPick}
            onChange={(e) => { setStatusPick(e.target.value); changeStatus(e.target.value); }}
            aria-label="עדכון סטטוס"
          >
            <option value="">🔄 עדכון סטטוס…</option>
            {MANUAL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button className="btn" onClick={remind}>📧 יצירת תזכורת</button>
          <button className="btn ghost" onClick={onClose} style={{ marginInlineStart: 'auto' }}>סגירה</button>
        </div>
      </div>
    </div>
  );
}
