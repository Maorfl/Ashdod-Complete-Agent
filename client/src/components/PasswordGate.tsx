/**
 * PasswordGate — שער סיסמה רך, משותף לכל עמודי הניהול ("ניהול מסופים ומשלחים",
 * "אוטומציה" וכו') — סיסמה אחת, sessionStorage משותף (SESSION_KEY קבוע), כך שפתיחה
 * בעמוד אחד פותחת גם את השני באותו session ולא מבקשים סיסמה פעמיים.
 *
 * ⚠️ שקיפות אבטחתית: זו אינה אבטחה אמיתית. הסיסמה ('1963') קבועה בקוד הצד-לקוח
 * ולכן גלויה ב-bundle ה-JS הבנוי לכל מי שיפתח את קוד המקור / כלי הפיתוח. זהו מחסום
 * הרתעה מפני גישה מקרית בלבד — לא מנגנון בקרת-גישה. אם נדרשת הגנה אמיתית, יש לממש
 * בדיקה בצד השרת (למשל אימות מול endpoint) במקום קבוע קשיח בקליינט.
 *
 * ה"פתיחה" נשמרת ב-sessionStorage — מבקשים סיסמה פעם אחת לכל session (לא בכל
 * אינטראקציה בתוך העמוד), עד סגירת הטאב. ביטול מחזיר לדשבורד.
 *
 * מניעת באג איבוד-פוקוס (חזר על עצמו פעמיים בפרויקט הזה — ConfirmModal עם
 * useEffect התלוי ב-onCancel שמקבל arrow function חדש בכל render של ההורה, גורם
 * לאפקט לרוץ מחדש ולגזול פוקוס בכל הקלדה): PasswordModal מוגדר כרכיב ברמת-המודול
 * (לא פונקציה מקוננת בתוך גוף רכיב אחר — דפוס שגורם ל-React למַנְט מחדש את ה-input
 * בכל הקלדה ולאבד פוקוס), מחזיק את ה-state של הסיסמה בתוך עצמו (כך שהקלדה אינה
 * מרנדרת מחדש את PasswordGate/ההורה), וה-useEffect הממקד רץ פעם אחת בלבד ב-mount
 * (deps ריקים) — לא תלוי ב-onCancel, כך שזהות ה-prop לא משפיעה על הפוקוס.
 */
import { ReactNode, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

// קבוע קשיח בכוונה — ראו הערת השקיפות למעלה. לא סוד אמיתי.
const GATE_PASSWORD = '1963';
const SESSION_KEY = 'tf_unlocked';

// רכיב מודאל ייעודי ברמת המודול (top-level) — שומר את ערך הסיסמה ב-state מקומי כדי
// שהקלדה תרנדר מחדש רק אותו, וממקד את ה-input פעם אחת ב-mount בלבד (deps ריקים —
// לא [onCancel], כדי שלא ירוץ מחדש ויגזול פוקוס בכל הקלדה שמרנדרת מחדש את ההורה).
function PasswordModal({ title, onUnlock, onCancel }: { title: string; onUnlock: () => void; onCancel: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  function attempt() {
    if (value === GATE_PASSWORD) onUnlock();
    else { setError(true); setValue(''); inputRef.current?.focus(); }
  }

  return (
    <div className="modal-overlay confirm-overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="confirm-modal" role="alertdialog" aria-modal="true" aria-label="נדרשת סיסמה">
        <div className="confirm-head">{title} — נדרשת סיסמה</div>
        <div className="confirm-body">
          <form onSubmit={(e) => { e.preventDefault(); attempt(); }}>
            <div className="field">
              <label htmlFor="tf-pass">הזינו סיסמה כדי לגשת לעמוד הניהול</label>
              <input
                id="tf-pass"
                ref={inputRef}
                type="password"
                inputMode="numeric"
                value={value}
                onChange={(e) => { setValue(e.target.value); setError(false); }}
              />
            </div>
            {error && <p className="hint-line" style={{ color: 'var(--st-alert)', fontWeight: 'bold' }}>סיסמה שגויה — נסו שוב.</p>}
            <p className="hint-line" style={{ color: 'var(--muted)', fontSize: 12 }}>
              הערה: זהו מחסום הרתעה בלבד (בדיקת סיסמה בצד הלקוח), לא אבטחה מלאה — הסיסמה גלויה בקוד ה-JS הבנוי.
            </p>
          </form>
        </div>
        <div className="confirm-foot">
          <button className="btn primary" onClick={attempt}>כניסה</button>
          <button className="btn" onClick={onCancel}>ביטול</button>
        </div>
      </div>
    </div>
  );
}

export default function PasswordGate({ children, title = 'ניהול מסופים ומשלחים' }: { children: ReactNode; title?: string }) {
  const navigate = useNavigate();
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem(SESSION_KEY) === '1');

  if (unlocked) return <>{children}</>;

  return (
    <PasswordModal
      title={title}
      onUnlock={() => { sessionStorage.setItem(SESSION_KEY, '1'); setUnlocked(true); }}
      onCancel={() => navigate('/')}
    />
  );
}
