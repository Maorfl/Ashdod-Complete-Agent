/**
 * ShipmentNotesModal — מודאל עריכת הערות לתיק ספציפי (לא טיוטת מייל).
 * פועל ישירות מול השרת לשמירת הערות בלבד.
 */
import { useState } from 'react';
import { api, Shipment } from '../api';
import { useToast } from './Toasts';
import ConfirmModal from './ConfirmModal';

export default function ShipmentNotesModal({ item, onCancel, onSaved }: {
  item: Shipment;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [notes, setNotes] = useState(item.notes || '');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api.updateShipmentNotes(item.file_number, notes.trim());
      toast('ההערות עודכנו בהצלחה ✓', 'success');
      onSaved();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfirmModal
      title={`הערות לתיק ${item.file_number}`}
      confirmLabel="שמור הערות"
      busy={busy}
      onConfirm={save}
      onCancel={onCancel}
    >
      <div className="field">
        <label htmlFor="shipment-notes-textarea">הערות לתיק</label>
        <textarea
          id="shipment-notes-textarea"
          rows={5}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="הקלד הערות עבור תיק זה..."
          autoFocus
        />
      </div>
    </ConfirmModal>
  );
}
