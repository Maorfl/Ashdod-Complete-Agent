import { useEffect, useMemo, useState } from 'react';
import { api, Importer } from '../api';
import { useAgentFilter, matchesAgent } from '../context/AgentFilterContext';
import ConfirmModal from '../components/ConfirmModal';
import EmailListEditor from '../components/EmailListEditor';

const BLANK: Partial<Importer> = {
  name: '', company_id: '', emails: [], address: '', notes: '',
  department: '', type: 'unknown', dangerous_rule: false,
  cont_general: '', cont_general_emails: [], cont_dangerous_emails: [], aliases: [],
};

const DEPTS = [
  { v: '', l: '—' },
  { v: 'cus1', l: 'CUS1 · משה רוסו' },
  { v: 'cus2', l: 'CUS2 · דורון רימה' },
  { v: 'cus3', l: 'CUS3 · אביהוא עבדי' },
];
const TYPES = [
  { v: 'unknown', l: 'לא מסווג' },
  { v: 'haifa_cont', l: 'מוביל המשך קבוע' },
  { v: 'haifa_self', l: 'אוסף בעצמו' },
  { v: 'tls', l: 'TLS' },
  { v: 'direct', l: 'ישיר ללקוח' },
];

function listToText(a?: string[]) { return (a || []).join(', '); }

export default function Importers() {
  const { agent } = useAgentFilter();
  const [items, setItems] = useState<Importer[]>([]);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Importer | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [flash, setFlash] = useState<{ t: string; ok: boolean } | null>(null);
  const [activeDeleteImporter, setActiveDeleteImporter] = useState<Importer | null>(null);
  const [activeNotesImporter, setActiveNotesImporter] = useState<Importer | null>(null);
  const [tempNotes, setTempNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);

  function load() { api.importers().then(setItems).catch((e) => setFlash({ t: e.message, ok: false })); }
  useEffect(load, []);

  const filtered = useMemo(() => {
    const byAgent = items.filter((i) => matchesAgent(i, agent));
    const s = q.trim().toLowerCase();
    if (!s) return byAgent;
    return byAgent.filter((i) =>
      i.name.toLowerCase().includes(s) ||
      (i.company_id || '').includes(s) ||
      (i.department || '').includes(s));
  }, [items, q, agent]);

  function openNew() { setEditing({ ...BLANK } as Importer); setIsNew(true); }
  function openEdit(i: Importer) { setEditing({ ...i }); setIsNew(false); }
  function close() { setEditing(null); }

  async function save() {
    if (!editing) return;
    try {
      if (isNew) await api.createImporter(editing);
      else await api.updateImporter(editing._folder!, editing);
      setFlash({ t: isNew ? 'יבואן נוסף' : 'הנתונים נשמרו', ok: true });
      close(); load();
    } catch (e: any) { setFlash({ t: e.message, ok: false }); }
  }

  function del(i: Importer) {
    setActiveDeleteImporter(i);
  }

  async function performDelete(i: Importer) {
    try {
      await api.deleteImporter(i._folder!);
      setFlash({ t: 'היבואן נמחק', ok: true });
      load();
    } catch (e: any) {
      setFlash({ t: e.message, ok: false });
    } finally {
      setActiveDeleteImporter(null);
    }
  }

  function openNotesModal(i: Importer) {
    setActiveNotesImporter(i);
    setTempNotes(i.notes || '');
  }

  const set = (k: keyof Importer, v: any) => setEditing((e) => (e ? { ...e, [k]: v } : e));

  return (
    <>
      <div className="page-head"><h1>ניהול יבואנים</h1>
        <p>כל יבואן נשמר בתיקייה משלו עם קובץ נתונים. עריכה כאן נכתבת ישירות ל-importer.json של היבואן.</p>
      </div>

      {flash && <div className={'flash ' + (flash.ok ? 'ok' : 'err')}>{flash.t}</div>}

      <div className="toolbar">
        <div className="search"><input placeholder="חיפוש לפי שם, ח.פ או מחלקה…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <span className="mono" style={{ color: 'var(--muted)' }}>{filtered.length} יבואנים</span>
        <button className="btn primary" onClick={openNew}>+ יבואן חדש</button>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>שם היבואן</th>
              <th>ח.פ</th>
              <th>מחלקה</th>
              <th>מיילים</th>
              <th>הערות</th>
              <th>פעולות</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((i) => {
              const emailsText = listToText(i.emails) || '—';
              const truncatedEmails = emailsText.length > 30 ? `${emailsText.slice(0, 27)}...` : emailsText;
              const notesText = i.notes || '';
              const truncatedNotes = notesText.length > 30 ? `${notesText.slice(0, 27)}...` : notesText;

              return (
                <tr key={i._folder}>
                  <td><b>{i.name}</b>{i.dangerous_rule && <span title="כלל חומר מסוכן"> ⚠</span>}</td>
                  <td className="mono">{i.company_id || '—'}</td>
                  <td>{i.department ? i.department.toUpperCase() : '—'}</td>
                  <td className="mono" style={{ fontSize: 12, color: 'var(--muted)' }} title={emailsText.length > 30 ? emailsText : undefined}>
                    {truncatedEmails}
                  </td>
                  <td>
                    {notesText ? (
                      <div
                        title={notesText}
                        style={{ cursor: 'pointer', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        onClick={() => openNotesModal(i)}
                      >
                        {truncatedNotes}
                      </div>
                    ) : (
                      <button className="btn sm ghost" onClick={() => openNotesModal(i)} style={{ padding: '2px 6px', fontSize: 12 }}>
                        ＋ הוסף הערה
                      </button>
                    )}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="btn sm" onClick={() => openEdit(i)}>עריכה</button>
                      <button className="btn sm danger" onClick={() => del(i)}>מחיקה</button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && <tr><td colSpan={6}><div className="empty">לא נמצאו יבואנים תואמים.</div></td></tr>}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <div className="drawer">
            <div className="dh"><h3>{isNew ? 'יבואן חדש' : editing.name}</h3><button className="x" onClick={close}>×</button></div>
            <div className="db">
              <div className="field"><label>שם היבואן</label>
                <input value={editing.name} onChange={(e) => set('name', e.target.value)} disabled={!isNew} /></div>
              <div className="grid-2">
                <div className="field"><label>ח.פ</label><input value={editing.company_id} onChange={(e) => set('company_id', e.target.value)} /></div>
                <div className="field"><label>מחלקה</label>
                  <select value={editing.department} onChange={(e) => set('department', e.target.value)}>
                    {DEPTS.map((d) => <option key={d.v} value={d.v}>{d.l}</option>)}</select></div>
              </div>
              <div className="field"><label>כתובת</label><input value={editing.address} onChange={(e) => set('address', e.target.value)} /></div>
              <EmailListEditor
                label="מיילים של היבואן"
                emails={editing.emails || []}
                onChange={(next) => set('emails', next)}
              />
              <div className="grid-2">
                <div className="field"><label>סוג טיפול</label>
                  <select value={editing.type} onChange={(e) => set('type', e.target.value)}>
                    {TYPES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}</select></div>
                <div className="field"><label>מוביל המשך</label><input value={editing.cont_general} onChange={(e) => set('cont_general', e.target.value)} /></div>
              </div>
              <EmailListEditor
                label="מיילי מוביל המשך"
                emails={editing.cont_general_emails || []}
                onChange={(next) => set('cont_general_emails', next)}
              />
              <EmailListEditor
                label='מיילי מוביל חומ"ס'
                emails={editing.cont_dangerous_emails || []}
                onChange={(next) => set('cont_dangerous_emails', next)}
              />
              <div className="field" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input type="checkbox" style={{ width: 18 }} checked={editing.dangerous_rule} onChange={(e) => set('dangerous_rule', e.target.checked)} />
                <label style={{ margin: 0 }}>חל כלל חומר מסוכן (Hazardous → סמא)</label>
              </div>
              <div className="field"><label>הערות מיוחדות</label>
                <textarea rows={3} value={editing.notes} onChange={(e) => set('notes', e.target.value)} /></div>
            </div>
            <div className="df">
              <button className="btn primary" onClick={save}>{isNew ? 'הוספה' : 'שמירה'}</button>
              <button className="btn" onClick={close}>ביטול</button>
            </div>
          </div>
        </div>
      )}

      {activeDeleteImporter && (
        <ConfirmModal
          title={`מחיקת יבואן — ${activeDeleteImporter.name}`}
          confirmLabel="מחק יבואן"
          danger={true}
          onConfirm={() => performDelete(activeDeleteImporter)}
          onCancel={() => setActiveDeleteImporter(null)}
        >
          האם אתה בטוח שברצונך למחוק את היבואן "{activeDeleteImporter.name}"? התיקייה והנתונים יימחקו.
        </ConfirmModal>
      )}

      {activeNotesImporter && (
        <ConfirmModal
          title={`הערות עבור ${activeNotesImporter.name}`}
          confirmLabel="שמור הערה"
          busy={savingNotes}
          onConfirm={async () => {
            setSavingNotes(true);
            try {
              await api.updateImporter(activeNotesImporter._folder!, { notes: tempNotes });
              setFlash({ t: 'הערה עודכנה בהצלחה', ok: true });
              setActiveNotesImporter(null);
              load();
            } catch (e: any) {
              setFlash({ t: e.message, ok: false });
            } finally {
              setSavingNotes(false);
            }
          }}
          onCancel={() => setActiveNotesImporter(null)}
        >
          <div className="field">
            <label htmlFor="notes-textarea">הערות מיוחדות</label>
            <textarea
              id="notes-textarea"
              rows={5}
              value={tempNotes}
              onChange={(e) => setTempNotes(e.target.value)}
              placeholder="הקלד הערות כאן..."
              autoFocus
            />
          </div>
        </ConfirmModal>
      )}
    </>
  );
}
