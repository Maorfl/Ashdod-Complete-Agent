/**
 * ReminderModal — יצירת תזכורת עם הערת מחלקה חופשית.
 * הטיוטה נכנסת לתור האישורים — לא נשלח מייל ישירות (human-in-the-loop).
 */
import { useState } from 'react';
import { api, Shipment } from '../api';
import { statusLabel } from '../status';
import { useToast } from './Toasts';
import ConfirmModal from './ConfirmModal';

export default function ReminderModal({ item, onCancel, onCreated }: {
  item: Shipment;
  onCancel: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      await api.createReminder(item.file_number, notes.trim() || undefined);
      toast('טיוטת תזכורת נוצרה וממתינה לאישור ✓', 'success');
      onCreated();
    } catch (e: any) {
      toast(e.message, 'error');
      setBusy(false);
    }
  }

  return (
    <ConfirmModal
      title={`יצירת תזכורת — תיק ${item.file_number}`}
      confirmLabel="📧 יצירת טיוטה"
      busy={busy}
      onConfirm={create}
      onCancel={onCancel}
    >
      <table className="details-table" style={{ width: '100%', marginBottom: 14 }}>
        <tbody>
          <tr><th>לקוח</th><td>{item.customer_name || '—'}</td></tr>
          <tr><th>מוביל / מסוף</th><td>{item.continuation || '—'}</td></tr>
          <tr><th>סטטוס</th><td>{statusLabel(item.status)}</td></tr>
        </tbody>
      </table>
      <label htmlFor="rem-notes">הערת מחלקה (תשולב בגוף התזכורת)</label>
      <textarea
        id="rem-notes"
        rows={3}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="לא חובה — למשל: נא לזרז, הלקוח ממתין למטען"
      />
      <p className="hint-line">תיווצר טיוטה שתמתין לאישור בעמוד האישורים — לא יישלח מייל ישירות.</p>
    </ConfirmModal>
  );
}
