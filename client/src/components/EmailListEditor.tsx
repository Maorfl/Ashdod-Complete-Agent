/**
 * EmailListEditor — עורך רשימת מיילים מבוסס צ'יפים (הוספה/הסרה פרטנית + ולידציה).
 * מודל הנתונים נשאר string[] — שיפור UX בצד הלקוח בלבד, ללא שינוי backend.
 */
import { useState, KeyboardEvent } from 'react';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function EmailListEditor({ label, emails, onChange, placeholder }: {
  label: string;
  emails: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState('');

  function add() {
    const v = draft.trim().toLowerCase();
    if (!v) return;
    if (!EMAIL_RE.test(v)) { setErr('כתובת מייל לא תקינה'); return; }
    if (emails.some((e) => e.toLowerCase() === v)) { setErr('הכתובת כבר קיימת ברשימה'); return; }
    onChange([...emails, v]);
    setDraft('');
    setErr('');
  }

  function remove(idx: number) {
    onChange(emails.filter((_, i) => i !== idx));
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); add(); }
  }

  return (
    <div className="field email-editor">
      <label>{label}</label>
      {emails.length > 0 && (
        <div className="chips">
          {emails.map((e, i) => (
            <span className="email-chip" key={e + i}>
              {e}
              <button
                type="button" className="rm"
                aria-label={`הסרת ${e}`} title="הסרה"
                onClick={() => remove(i)}
              >✕</button>
            </span>
          ))}
        </div>
      )}
      <div className="add-row">
        <input
          type="email"
          value={draft}
          placeholder={placeholder || 'name@example.com'}
          onChange={(e) => { setDraft(e.target.value); if (err) setErr(''); }}
          onKeyDown={onKey}
          aria-label={label + ' — הוספת כתובת'}
        />
        <button type="button" className="btn sm" onClick={add}>+ הוספה</button>
      </div>
      {err && <p className="err-line" role="alert">{err}</p>}
    </div>
  );
}
