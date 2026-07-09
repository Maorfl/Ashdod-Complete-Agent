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
    // תמיכה בהדבקת רשימה מופרדת ב-; או , (Task 7): מפצל, מנרמל, מוסיף את התקינות
    // שאינן כפולות בבת אחת, ומדווח משוב מצטבר במקום דחייה של הכל.
    const tokens = draft.split(/[;,]+/).map((t) => t.trim().toLowerCase()).filter(Boolean);
    if (!tokens.length) return;
    const next = [...emails];
    const existing = new Set(emails.map((e) => e.toLowerCase()));
    let added = 0, invalid = 0, dup = 0;
    for (const t of tokens) {
      if (!EMAIL_RE.test(t)) { invalid += 1; continue; }
      if (existing.has(t)) { dup += 1; continue; }
      existing.add(t); next.push(t); added += 1;
    }
    if (added) onChange(next);
    if (added && !invalid && !dup) { setDraft(''); setErr(''); return; }
    const parts = [];
    if (added) parts.push(`נוספו ${added}`);
    if (dup) parts.push(`כפולות ${dup}`);
    if (invalid) parts.push(`לא תקינות ${invalid}`);
    setErr(parts.join(' · '));
    if (added) setDraft(''); // נשאר בשדה רק אם שום דבר לא נוסף, לתיקון
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
