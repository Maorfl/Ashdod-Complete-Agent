/**
 * Automation — "אוטומציה": בקרת שליחה אוטומטית של מיילי העברה לחיפה, לכל מחלקה
 * בנפרד (off/dry_run/on) + מתג-כיבוי גלובלי, וסעיף "נדרש לטיפול" — תיקים
 * שהשער (gate) מחזיק/מסמן לבדיקה ידנית. חתך-הגיל (epoch) מוצג במפורש כדי שיהיה
 * ברור שהאוטומציה חלה רק על תיקים חדשים — לא על מצבת התיקים שהייתה קיימת קודם.
 */
import { useEffect, useMemo, useState } from 'react';
import { api, AutomationState, AutomationMode, Shipment } from '../api';
import { useAgentFilter, matchesAgent, AGENTS } from '../context/AgentFilterContext';
import { useToast } from '../components/Toasts';
import ConfirmModal from '../components/ConfirmModal';
import FileModal from '../components/FileModal';
import { formatDuration, formatDateTimeHe, needsAttentionReason, isStaleHold } from '../status';

const DEPT_META: { key: 'cus1' | 'cus2' | 'cus3'; name: string; code: string }[] = [
  { key: 'cus1', name: 'משה רוסו', code: 'CUS1' },
  { key: 'cus2', name: 'דורון רימה', code: 'CUS2' },
  { key: 'cus3', name: 'אביהוא עבדי', code: 'CUS3' },
];

const MODE_META: Record<AutomationMode, { label: string; cssVar: string; icon: string }> = {
  off: { label: 'כבוי', cssVar: 'var(--muted)', icon: '⏸' },
  dry_run: { label: 'סימולציה (dry run)', cssVar: 'var(--st-pending)', icon: '🧪' },
  on: { label: 'פעיל — שולח בפועל', cssVar: 'var(--st-arrived)', icon: '🟢' },
};

function fmtEpoch(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!isFinite(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)}`;
}

export default function Automation() {
  const { agent } = useAgentFilter();
  const toast = useToast();
  const [state, setState] = useState<AutomationState | null>(null);
  const [items, setItems] = useState<Shipment[] | null>(null);
  const [err, setErr] = useState('');
  const [pendingOn, setPendingOn] = useState<{ dept: string; name: string } | null>(null);
  const [pendingKill, setPendingKill] = useState(false);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [savingDept, setSavingDept] = useState<string | null>(null);
  const [savingKill, setSavingKill] = useState(false);

  function load() {
    api.automationState().then(setState).catch((e) => setErr(e.message));
    api.dashboard().then((d) => setItems(d.items)).catch((e) => setErr(e.message));
  }
  useEffect(load, []);

  async function applyDeptMode(dept: string, mode: AutomationMode) {
    setSavingDept(dept);
    try {
      const next = await api.setAutomationDept(dept, mode);
      setState(next);
      toast(`מצב האוטומציה עבור ${dept.toUpperCase()} עודכן ל"${MODE_META[mode].label}" ✓`, 'success');
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setSavingDept(null);
      setPendingOn(null);
    }
  }

  function chooseMode(dept: string, name: string, mode: AutomationMode) {
    if (mode === 'on') { setPendingOn({ dept, name }); return; }
    applyDeptMode(dept, mode);
  }

  async function applyKillSwitch(on: boolean) {
    setSavingKill(true);
    try {
      const next = await api.setAutomationKillSwitch(on);
      setState(next);
      toast(on ? 'מתג הכיבוי הופעל — כל האוטומציה כבויה ✓' : 'מתג הכיבוי כובה — חוזרים למצב לכל מחלקה ✓', 'success');
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setSavingKill(false);
      setPendingKill(false);
    }
  }

  // תיקים "נדרש לטיפול": יש להם סיבה אנושית-פעולה (alert / ממתין ל-PDF / needs_review),
  // וגם אינם מוחרגים מהאוטומציה ע"י חתך-הגיל (אלה כבר "מטופלים ידנית כרגיל" ולא
  // קשורים לאוטומציה — מוצגים בקבוצה נפרדת ומעומעמת, לא כ"נדרש לטיפול").
  const agentItems = useMemo(() => (items || []).filter((s) => matchesAgent(s, agent)), [items, agent]);

  const needsAttention = useMemo(() => {
    return agentItems
      .map((s) => ({ s, reason: needsAttentionReason(s) }))
      .filter((x): x is { s: Shipment; reason: string } => !!x.reason)
      .sort((a, b) => {
        const ah = isStaleHold(a.s) ? 1 : 0;
        const bh = isStaleHold(b.s) ? 1 : 0;
        if (ah !== bh) return bh - ah; // תקועים מעל הסף תחילה
        return new Date(b.s.status_updated_at || 0).getTime() - new Date(a.s.status_updated_at || 0).getTime();
      });
  }, [agentItems]);

  const openItem = useMemo(() => agentItems.find((s) => s.file_number === openFile) || null, [agentItems, openFile]);

  return (
    <>
      <div className="page-head">
        <h1>אוטומציה</h1>
        <p>שליחה אוטומטית של מיילי "העברה לחיפה" ללא אישור אנושי, לכל מחלקה בנפרד. כברירת מחדל כבויה — הפעלה דורשת אישור מפורש.</p>
      </div>

      {err && <div className="flash err">{err} — ודאו שהשרת פעיל (npm start).</div>}

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <button
            className={'btn' + (state?.killSwitch ? ' danger solid' : '')}
            disabled={savingKill}
            onClick={() => (state?.killSwitch ? applyKillSwitch(false) : setPendingKill(true))}
          >
            {state?.killSwitch ? '⏸ מתג כיבוי פעיל — לחצו לביטול' : '🛑 כיבוי חירום — כל האוטומציה'}
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 0, marginBottom: 20 }}>
        <table>
          <thead>
            <tr><th>מחלקה</th><th>מצב נוכחי</th><th>שינוי מצב</th></tr>
          </thead>
          <tbody>
            {DEPT_META.map((d) => {
              const mode = state?.departments?.[d.key] || 'off';
              const meta = MODE_META[mode];
              return (
                <tr key={d.key}>
                  <td><b>{d.name}</b> <span className="mono" style={{ color: 'var(--muted)', fontSize: 12 }}>{d.code}</span></td>
                  <td>
                    <span className="st-badge" style={{ ['--c' as any]: state?.killSwitch ? 'var(--muted)' : meta.cssVar }}>
                      {meta.icon} {state?.killSwitch ? 'כבוי (מתג כיבוי גלובלי)' : meta.label}
                    </span>
                  </td>
                  <td>
                    <div className="row-actions">
                      {(['off', 'dry_run', 'on'] as AutomationMode[]).map((m) => (
                        <button
                          key={m}
                          className={'btn sm' + (mode === m ? ' primary' : '')}
                          disabled={savingDept === d.key || !!state?.killSwitch}
                          onClick={() => chooseMode(d.key, d.name, m)}
                        >
                          {MODE_META[m].icon} {MODE_META[m].label}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="page-head" style={{ marginTop: 8 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>נדרש לטיפול</h2>
        <p>תיקים שהשער חוסם משליחה אוטומטית, או שסומנו לבדיקה ידנית — מסונן לפי הסוכן שנבחר למעלה ({AGENTS.find((a) => a.key === agent)?.name}).</p>
      </div>

      <div className="card table-card">
        {items === null && <div className="empty"><div className="big">⏳</div>טוען נתונים…</div>}
        {items !== null && needsAttention.length === 0 && (
          <div className="empty"><div className="big">✓</div>אין תיקים הדורשים טיפול{agent !== 'all' ? ' עבור הסוכן שנבחר' : ''}.</div>
        )}
        {needsAttention.length > 0 && (
          <div className="table-scroll">
            <table className="ship-table">
              <thead>
                <tr><th>תיק</th><th>לקוח</th><th>מחלקה</th><th>סיבה</th><th>זמן בסטטוס</th><th></th></tr>
              </thead>
              <tbody>
                {needsAttention.map(({ s, reason }) => {
                  const stale = isStaleHold(s);
                  return (
                    <tr key={s.file_number} className="ship-row" onClick={() => setOpenFile(s.file_number)}>
                      <td className="mono file-cell" style={{ ['--c' as any]: stale ? 'var(--st-alert)' : 'var(--st-pending)' }}>
                        {s.file_number}
                      </td>
                      <td className="cust-cell">{s.customer_name || '—'}</td>
                      <td>{s.department ? s.department.toUpperCase() : '—'}</td>
                      <td style={{ fontSize: 13 }}>
                        {reason}
                        {stale && <span className="st-badge" style={{ ['--c' as any]: 'var(--st-alert)', marginInlineStart: 6 }}>⏰ תקוע</span>}
                      </td>
                      <td className="mono time-cell" title={formatDateTimeHe(s.status_updated_at)}>{formatDuration(s.status_updated_at)}</td>
                      <td className="actions-cell" onClick={(e) => e.stopPropagation()}>
                        <button className="btn icon" title="כרטיס תיק" aria-label="כרטיס תיק" onClick={() => setOpenFile(s.file_number)}>👁</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {openItem && <FileModal item={openItem} onClose={() => setOpenFile(null)} onChanged={() => load()} />}

      {pendingOn && (
        <ConfirmModal
          title={`הפעלת שליחה אוטומטית — ${pendingOn.name} (${pendingOn.dept.toUpperCase()})`}
          confirmLabel="הפעל שליחה אוטומטית"
          danger={true}
          busy={savingDept === pendingOn.dept}
          onConfirm={() => applyDeptMode(pendingOn.dept, 'on')}
          onCancel={() => setPendingOn(null)}
        >
          <p className="hint-line" style={{ color: 'var(--st-alert)', fontWeight: 'bold' }}>
            ⚠ ממצב זה ואילך, מיילי "העברה לחיפה" חדשים של מחלקה זו יישלחו אוטומטית לנמענים אמיתיים — ללא אישור אנושי בתור האישורים.
          </p>
          <p style={{ marginTop: 8 }}>ניתן לחזור בכל רגע ל"כבוי" או ל"סימולציה". תיקים שנכנסו לפני חתך-הגיל ({fmtEpoch(state?.epoch ?? null)}) לעולם אינם נשלחים אוטומטית.</p>
        </ConfirmModal>
      )}

      {pendingKill && (
        <ConfirmModal
          title="כיבוי חירום — כל האוטומציה"
          confirmLabel="כבה את כל האוטומציה"
          danger={true}
          busy={savingKill}
          onConfirm={() => applyKillSwitch(true)}
          onCancel={() => setPendingKill(false)}
        >
          <p>מתג זה משבית מיידית את השליחה האוטומטית עבור כל המחלקות, ללא קשר למצב האישי שלהן. ניתן לבטל בכל רגע.</p>
        </ConfirmModal>
      )}
    </>
  );
}
