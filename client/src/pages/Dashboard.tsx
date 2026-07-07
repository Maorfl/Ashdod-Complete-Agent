/**
 * Dashboard — טבלת תיקים מלאה בהשראת דשבורד ה-Python, בשפת העיצוב של הנמל.
 * כרטיסי סטטוס לחיצים + שורת פילטרים + טבלה עם פעולות + כרטיס תיק (מודאל).
 * רענון אוטומטי כל 60 שניות. מכבד את מסנן הסוכן הגלובלי.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, Shipment, DashboardCounts } from '../api';
import { useAgentFilter, matchesAgent } from '../context/AgentFilterContext';
import { useToast } from '../components/Toasts';
import FileModal from '../components/FileModal';
import ConfirmModal from '../components/ConfirmModal';
import ShipmentNotesModal from '../components/ShipmentNotesModal';
import {
  STATUS_META, STATUS_ORDER, statusKeyOf, statusLabel, MANUAL_STATUSES,
  formatDateHe, formatDuration, timeSeverity, StatusKey,
} from '../status';

export default function Dashboard() {
  const { agent } = useAgentFilter();
  const toast = useToast();
  const [items, setItems] = useState<Shipment[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<StatusKey | 'all'>('all');
  const [q, setQ] = useState(''); // חיפוש לפי מספר תיק / שם לקוח
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [statusPick, setStatusPick] = useState<Record<string, string>>({});
  const [activeDeliverItem, setActiveDeliverItem] = useState<Shipment | null>(null);
  const [activeStatusUpdate, setActiveStatusUpdate] = useState<{ item: Shipment; nextStatus: string } | null>(null);
  const [activeNotesItem, setActiveNotesItem] = useState<Shipment | null>(null);
  const timerRef = useRef<number | null>(null);

  const load = useCallback((manual = false) => {
    api.dashboard()
      .then((d) => {
        setItems(d.items);
        setErr('');
        setLastUpdated(new Date());
        if (manual) toast('הנתונים עודכנו ✓', 'success');
      })
      .catch((e) => { setErr(e.message); if (manual) toast('שגיאה בטעינת נתונים', 'error'); });
  }, [toast]);

  useEffect(() => {
    load();
    timerRef.current = window.setInterval(load, 60000);
    return () => { if (timerRef.current) window.clearInterval(timerRef.current); };
  }, [load]);

  // מסנן הסוכן חל על הכל — מונים, טבלה ומודאל
  const agentItems = useMemo(() => (items || []).filter((s) => matchesAgent(s, agent)), [items, agent]);

  const counts = useMemo(() => {
    const c: DashboardCounts = { pending_approval: 0, released_ashdod: 0, to_haifa: 0, delivered: 0, alert: 0 };
    for (const s of agentItems) {
      const k = statusKeyOf(s);
      if (k !== 'other') c[k] += 1;
    }
    return c;
  }, [agentItems]);

  const visible = useMemo(() => {
    let list = filter === 'all'
      ? agentItems.filter((s) => statusKeyOf(s) !== 'delivered')
      : agentItems.filter((s) => statusKeyOf(s) === filter);
    // חיפוש חופשי — התאמת substring לא-רגישת-רישיות למספר תיק או שם לקוח
    const needle = q.trim().toLowerCase();
    if (needle) {
      list = list.filter((s) =>
        String(s.file_number || '').toLowerCase().includes(needle) ||
        String(s.customer_name || '').toLowerCase().includes(needle));
    }
    return [...list].sort((a, b) => {
      const ai = STATUS_ORDER.indexOf(statusKeyOf(a));
      const bi = STATUS_ORDER.indexOf(statusKeyOf(b));
      if (ai !== bi) return ai - bi;
      return new Date(b.status_updated_at || 0).getTime() - new Date(a.status_updated_at || 0).getTime();
    });
  }, [agentItems, filter, q]);

  const openItem = useMemo(() => visible.find((s) => s.file_number === openFile) || null, [visible, openFile]);

  function toggleFilter(k: StatusKey | 'all') {
    setFilter((f) => (f === k ? 'all' : k));
  }

  async function runNow() {
    setErr(''); setBusy(true);
    try { await api.runWatcher(); load(); toast('סריקת הדוח הושלמה ✓', 'success'); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function performDeliver(s: Shipment) {
    try {
      await api.updateStatus(s.file_number, 'נמסר ללקוח');
      toast('התיק הועבר ללשונית נמסר ללקוח ✓', 'success');
      load();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setActiveDeliverItem(null);
    }
  }

  async function performStatusUpdate(s: Shipment, status: string) {
    try {
      await api.updateStatus(s.file_number, status);
      toast(`הסטטוס עודכן ל"${status}" ✓`, 'success');
      load();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setStatusPick((p) => ({ ...p, [s.file_number]: '' }));
      setActiveStatusUpdate(null);
    }
  }

  function deliver(s: Shipment) {
    setActiveDeliverItem(s);
  }

  function changeStatus(s: Shipment, status: string) {
    if (!status) return;
    setActiveStatusUpdate({ item: s, nextStatus: status });
  }

  function openNotes(s: Shipment) {
    setActiveNotesItem(s);
  }

  const clock = lastUpdated
    ? lastUpdated.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '—';

  return (
    <>
      <div className="page-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1>דשבורד מטענים</h1>
          <p>מצבת תיקים — שחרור באשדוד והעברה לחיפה. {agentItems.length} תיקים במעקב.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="refresh-info mono">עדכון אחרון: {clock}</span>
          <button className="btn" onClick={() => load(true)}>🔄 רענון</button>
          <button className="btn primary" onClick={runNow} disabled={busy}>{busy ? 'סורק…' : 'סרוק דוח עכשיו'}</button>
        </div>
      </div>

      {err && <div className="flash err">{err} — ודאו שהשרת פעיל (npm start).</div>}

      <div className="strip">
        {STATUS_META.map((m) => (
          <button
            className={'stat clickable' + (filter === m.key ? ' active' : '')}
            key={m.key}
            style={{ ['--c' as any]: m.cssVar }}
            onClick={() => toggleFilter(m.key)}
            aria-pressed={filter === m.key}
          >
            <div className="n">{counts[m.key]}</div>
            <div className="l">{m.label}</div>
          </button>
        ))}
      </div>

      <div className="filter-bar">
        <div className="search"><input placeholder="חיפוש לפי מספר תיק או שם לקוח…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <button className={'pill' + (filter === 'all' ? ' active' : '')} onClick={() => setFilter('all')}>הכל</button>
        {STATUS_META.map((m) => (
          <button
            key={m.key}
            className={'pill' + (filter === m.key ? ' active' : '')}
            style={{ ['--c' as any]: m.cssVar }}
            onClick={() => toggleFilter(m.key)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="card table-card">
        {items === null && (
          <div className="empty"><div className="big">⏳</div>טוען נתונים…</div>
        )}
        {items !== null && agentItems.length === 0 && (
          <div className="empty">
            <div className="big">⚓</div>
            אין תיקים במעקב{agent !== 'all' ? ' עבור הסוכן שנבחר' : ''}. לחצו "סרוק דוח עכשיו" כדי לעבד את דוח ה-Focus.
          </div>
        )}
        {items !== null && agentItems.length > 0 && visible.length === 0 && (
          <div className="empty"><div className="big">📭</div>אין תיקים בסינון הנוכחי.</div>
        )}
        {visible.length > 0 && (
          <div className="table-scroll">
            <table className="ship-table">
              <thead>
                <tr>
                  <th>תיק</th><th>לקוח</th><th>תאריך שחרור</th><th>סטטוס</th>
                  <th>מבצע העברה לחיפה</th><th>מחלקה</th><th>זמן בסטטוס</th><th>פעולות</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((s) => {
                  const k = statusKeyOf(s);
                  const meta = STATUS_META.find((m) => m.key === k);
                  const sev = timeSeverity(s);
                  return (
                    <tr key={s.file_number} className={'ship-row' + (s.notes ? ' has-notes' : '')} onClick={() => setOpenFile(s.file_number)}>
                      <td className="mono file-cell" style={{ ['--c' as any]: meta?.cssVar || 'var(--line)' }}>
                        {s.file_number}{s.hazardous === 'Yes' && <span title="חומר מסוכן"> ⚠</span>}
                      </td>
                      <td className="cust-cell">{s.customer_name || '—'}</td>
                      <td className="mono">{formatDateHe(s.release_date)}</td>
                      <td>
                        <span className="st-badge" style={{ ['--c' as any]: meta?.cssVar || 'var(--muted)' }}>{statusLabel(s.status)}</span>
                        {s.auto_sent ? <span className="st-badge" style={{ ['--c' as any]: 'var(--st-arrived)', marginInlineStart: 4 }} title="נשלח אוטומטית ללא אישור אנושי (העברה לחיפה)">⚡ אוטומטי</span> : null}
                      </td>
                      <td>{s.transfer_performer || '—'}</td>
                      <td>{s.department ? s.department.toUpperCase() : '—'}</td>
                      <td className={'mono time-cell' + (sev ? ' time-' + sev : '')}>{formatDuration(s.status_updated_at)}</td>
                      <td className="actions-cell" onClick={(e) => e.stopPropagation()}>
                        <div className="row-actions">
                          {s.status !== 'נמסר ללקוח' && (
                            <button className="btn icon" title="סימון כנמסר" aria-label="סימון כנמסר" onClick={() => deliver(s)}>✅</button>
                          )}
                          <select
                            className="status-pick sm"
                            value={statusPick[s.file_number] || ''}
                            onChange={(e) => changeStatus(s, e.target.value)}
                            title="עדכון סטטוס" aria-label="עדכון סטטוס"
                          >
                            <option value="">🔄 עדכון סטטוס</option>
                            {MANUAL_STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
                          </select>
                          <button className={'btn icon' + (s.notes ? ' noted' : '')} title={s.notes ? `הערות לתיק: ${s.notes}` : 'הערות לתיק'} aria-label="הערות לתיק" onClick={() => openNotes(s)}>📝</button>
                          <button className="btn icon" title="כרטיס תיק" aria-label="כרטיס תיק" onClick={() => setOpenFile(s.file_number)}>👁</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {openItem && (
        <FileModal item={openItem} onClose={() => setOpenFile(null)} onChanged={() => load()} />
      )}

      {activeDeliverItem && (
        <ConfirmModal
          title={`סימון כנמסר — תיק ${activeDeliverItem.file_number}`}
          confirmLabel="אשר"
          onConfirm={() => performDeliver(activeDeliverItem)}
          onCancel={() => setActiveDeliverItem(null)}
        >
          לסמן תיק {activeDeliverItem.file_number} כנמסר ללקוח?
        </ConfirmModal>
      )}

      {activeStatusUpdate && (
        <ConfirmModal
          title={`עדכון סטטוס — תיק ${activeStatusUpdate.item.file_number}`}
          confirmLabel="עדכן"
          onConfirm={() => performStatusUpdate(activeStatusUpdate.item, activeStatusUpdate.nextStatus)}
          onCancel={() => {
            setStatusPick((p) => ({ ...p, [activeStatusUpdate.item.file_number]: '' }));
            setActiveStatusUpdate(null);
          }}
        >
          לעדכן את תיק {activeStatusUpdate.item.file_number} לסטטוס "{activeStatusUpdate.nextStatus}"?
        </ConfirmModal>
      )}

      {activeNotesItem && (
        <ShipmentNotesModal
          item={activeNotesItem}
          onCancel={() => setActiveNotesItem(null)}
          onSaved={() => {
            setActiveNotesItem(null);
            load();
          }}
        />
      )}
    </>
  );
}
