/**
 * TerminalsForwarders — "ניהול מסופים ומשלחים" (Task 3).
 * שתי טבלאות נפרדות (מסופים / משלחים-קו-לואדרים) מעל אותם config/terminals.json
 * ו-config/co_loaders.json ששאר הצנרת משתמשת בהם. עריכה בפועל דרך drawer מבוסס
 * EmailListEditor, בדומה ל-Importers.tsx. שמירה כותבת את האובייקט המלא בחזרה.
 */
import { useEffect, useMemo, useState } from 'react';
import { api, ContactEntry } from '../api';
import EmailListEditor from '../components/EmailListEditor';

type Kind = 'terminal' | 'coloader';

export default function TerminalsForwarders() {
  const [terminals, setTerminals] = useState<Record<string, ContactEntry>>({});
  const [coLoaders, setCoLoaders] = useState<Record<string, ContactEntry>>({});
  const [flash, setFlash] = useState<{ t: string; ok: boolean } | null>(null);
  const [editing, setEditing] = useState<{ kind: Kind; key: string; entry: ContactEntry; isNew: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  function load() {
    api.terminals().then(setTerminals).catch((e) => setFlash({ t: e.message, ok: false }));
    api.coLoaders().then(setCoLoaders).catch((e) => setFlash({ t: e.message, ok: false }));
  }
  useEffect(load, []);

  const termRows = useMemo(() => Object.entries(terminals), [terminals]);
  const coRows = useMemo(() => Object.entries(coLoaders), [coLoaders]);

  function openEdit(kind: Kind, key: string, entry: ContactEntry) {
    setEditing({ kind, key, entry: { ...entry, emails: [...(entry.emails || [])] }, isNew: false });
  }
  function openNew(kind: Kind) {
    setEditing({ kind, key: '', entry: { emails: [] }, isNew: true });
  }
  const setField = (k: string, v: unknown) =>
    setEditing((e) => (e ? { ...e, entry: { ...e.entry, [k]: v } } : e));
  const setKey = (v: string) => setEditing((e) => (e ? { ...e, key: v } : e));

  async function save() {
    if (!editing) return;
    const key = editing.key.trim();
    if (!key) { setFlash({ t: editing.kind === 'terminal' ? 'שם המסוף חובה' : 'קוד הקו-לואדר חובה', ok: false }); return; }
    setSaving(true);
    try {
      if (editing.kind === 'terminal') {
        const next = { ...terminals, [key]: editing.entry };
        setTerminals(await api.saveTerminals(next));
      } else {
        const next = { ...coLoaders, [key]: editing.entry };
        setCoLoaders(await api.saveCoLoaders(next));
      }
      setFlash({ t: 'נשמר בהצלחה', ok: true });
      setEditing(null);
    } catch (e: any) {
      setFlash({ t: e.message, ok: false });
    } finally {
      setSaving(false);
    }
  }

  const emailsText = (e: ContactEntry) => (e.emails || []).join(', ') || '—';

  return (
    <>
      <div className="page-head"><h1>ניהול מסופים ומשלחים</h1>
        <p>עריכת פרטי הקשר של המסופים ומבצעי ההעברה. נכתב ישירות ל-config/terminals.json ו-config/co_loaders.json — אותם קבצים שהצנרת משתמשת בהם.</p>
      </div>

      {flash && <div className={'flash ' + (flash.ok ? 'ok' : 'err')}>{flash.t}</div>}

      {/* ---- מסופים ---- */}
      <div className="toolbar" style={{ marginTop: 8 }}>
        <h3 style={{ margin: 0 }}>מסופים</h3>
        <span className="mono" style={{ color: 'var(--muted)' }}>{termRows.length}</span>
        <button className="btn primary" onClick={() => openNew('terminal')}>+ מסוף חדש</button>
      </div>
      <div className="card" style={{ padding: 0, marginBottom: 24 }}>
        <table>
          <thead><tr><th>שם המסוף</th><th>תפקיד</th><th>מיילים</th><th>פעולות</th></tr></thead>
          <tbody>
            {termRows.map(([key, e]) => (
              <tr key={key}>
                <td><b>{key}</b>{e.needs_review ? <span title="ממתין לאימות"> ⏳</span> : null}</td>
                <td style={{ fontSize: 13, color: 'var(--muted)', maxWidth: 220 }}>{e.role || '—'}</td>
                <td className="mono" style={{ fontSize: 12, color: 'var(--muted)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={emailsText(e)}>{emailsText(e)}</td>
                <td><button className="btn sm" onClick={() => openEdit('terminal', key, e)}>עריכה</button></td>
              </tr>
            ))}
            {termRows.length === 0 && <tr><td colSpan={4}><div className="empty">אין מסופים.</div></td></tr>}
          </tbody>
        </table>
      </div>

      {/* ---- משלחים / קו-לואדרים ---- */}
      <div className="toolbar">
        <h3 style={{ margin: 0 }}>משלחים / קו-לואדרים</h3>
        <span className="mono" style={{ color: 'var(--muted)' }}>{coRows.length}</span>
        <button className="btn primary" onClick={() => openNew('coloader')}>+ משלח חדש</button>
      </div>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>קוד</th><th>שם</th><th>איש קשר</th><th>מיילים</th><th>פעולות</th></tr></thead>
          <tbody>
            {coRows.map(([key, e]) => (
              <tr key={key}>
                <td className="mono">{key}</td>
                <td><b>{e.name || '—'}</b>{e.needs_review ? <span title="ממתין לפרטי קשר"> ⏳</span> : null}<div style={{ fontSize: 12, color: 'var(--muted)' }}>{e.name_en}</div></td>
                <td>{e.contact || '—'}</td>
                <td className="mono" style={{ fontSize: 12, color: 'var(--muted)', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={emailsText(e)}>{emailsText(e)}</td>
                <td><button className="btn sm" onClick={() => openEdit('coloader', key, e)}>עריכה</button></td>
              </tr>
            ))}
            {coRows.length === 0 && <tr><td colSpan={5}><div className="empty">אין משלחים.</div></td></tr>}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setEditing(null)}>
          <div className="drawer">
            <div className="dh">
              <h3>{editing.isNew ? (editing.kind === 'terminal' ? 'מסוף חדש' : 'משלח חדש') : editing.key}</h3>
              <button className="x" onClick={() => setEditing(null)}>×</button>
            </div>
            <div className="db">
              <div className="field">
                <label>{editing.kind === 'terminal' ? 'שם המסוף (כמפתח)' : 'קוד הקו-לואדר (כמפתח)'}</label>
                <input value={editing.key} disabled={!editing.isNew} onChange={(e) => setKey(e.target.value)} />
              </div>
              {editing.kind === 'coloader' && (
                <div className="grid-2">
                  <div className="field"><label>שם</label><input value={(editing.entry.name as string) || ''} onChange={(e) => setField('name', e.target.value)} /></div>
                  <div className="field"><label>שם אנגלי</label><input value={(editing.entry.name_en as string) || ''} onChange={(e) => setField('name_en', e.target.value)} /></div>
                </div>
              )}
              <div className="grid-2">
                <div className="field"><label>איש קשר</label><input value={(editing.entry.contact as string) || ''} onChange={(e) => setField('contact', e.target.value)} /></div>
                <div className="field"><label>תפקיד / הערת מיקום</label><input value={(editing.entry.role as string) || ''} onChange={(e) => setField('role', e.target.value)} /></div>
              </div>
              <EmailListEditor label="מיילים" emails={editing.entry.emails || []} onChange={(next) => setField('emails', next)} />
              <div className="field"><label>הערות</label><textarea rows={3} value={(editing.entry.notes as string) || ''} onChange={(e) => setField('notes', e.target.value)} /></div>
              <div className="field" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input type="checkbox" style={{ width: 18 }} checked={!!editing.entry.needs_review} onChange={(e) => setField('needs_review', e.target.checked)} />
                <label style={{ margin: 0 }}>ממתין לאימות פרטי קשר</label>
              </div>
            </div>
            <div className="df">
              <button className="btn primary" onClick={save} disabled={saving}>{saving ? 'שומר…' : 'שמירה'}</button>
              <button className="btn" onClick={() => setEditing(null)} disabled={saving}>ביטול</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
