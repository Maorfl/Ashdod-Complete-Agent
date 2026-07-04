/**
 * ConfirmModal — מודאל אישור גנרי בשפת הנמל, מחליף את confirm() של הדפדפן.
 * נסגר ב-Escape ובלחיצה על הרקע; פוקוס אוטומטי על כפתור האישור;
 * נערם מעל כרטיס התיק (z-index גבוה יותר) כך שפעולות מתוך המודאל עובדות.
 */
import { ReactNode, useEffect, useRef } from 'react';

export default function ConfirmModal({
  title, children, confirmLabel, danger = false, busy = false, onConfirm, onCancel,
}: {
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="modal-overlay confirm-overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="confirm-modal" role="alertdialog" aria-modal="true" aria-label={title}>
        <div className="confirm-head">{title}</div>
        {children && <div className="confirm-body">{children}</div>}
        <div className="confirm-foot">
          <button
            ref={confirmRef}
            className={'btn ' + (danger ? 'danger solid' : 'primary')}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'מבצע…' : confirmLabel}
          </button>
          <button className="btn" onClick={onCancel} disabled={busy}>ביטול</button>
        </div>
      </div>
    </div>
  );
}
