import { useEffect, useMemo, useState } from 'react';
import { api, Shipment } from '../api';
import { useAgentFilter, matchesAgent } from '../context/AgentFilterContext';

export default function Approvals() {
  const { agent } = useAgentFilter();
  const [allItems, setAllItems] = useState<Shipment[]>([]);
  const items = useMemo(() => allItems.filter((s) => matchesAgent(s, agent)), [allItems, agent]);
  const [flash, setFlash] = useState<{ t: string; ok: boolean } | null>(null);
  const [editFile, setEditFile] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');

  function load() { api.approvals().then(setAllItems).catch((e) => setFlash({ t: e.message, ok: false })); }
  useEffect(load, []);

  async function decide(file: string, decision: string, edited?: any) {
    try {
      await api.decide(file, decision, edited);
      setFlash({
        t: decision === 'approve' ? 'אושר ונשלח מ-ashdod.agent@h-caspi.co.il' : decision === 'reject' ? 'הבקשה נדחתה' : 'הטיוטה עודכנה',
        ok: true,
      });
      setEditFile(null);
      load();
    } catch (e: any) { setFlash({ t: e.message, ok: false }); }
  }

  function startEdit(s: Shipment) {
    setEditFile(s.file_number);
    setEditBody(s.draft?.email.body || '');
  }

  return (
    <>
      <div className="page-head"><h1>אישורי שליחה</h1>
        <p>כל מייל מוצג לאישור המחלקה לפני שליחה בפועל. שום מייל אינו נשלח ללא אישור אנושי.</p>
      </div>

      {flash && <div className={'flash ' + (flash.ok ? 'ok' : 'err')}>{flash.t}</div>}

      {items.length === 0 && (
        <div className="card"><div className="empty"><div className="big">✓</div>
          אין מיילים הממתינים לאישור{agent !== 'all' && allItems.length > 0 ? ' עבור הסוכן שנבחר' : ''}.
        </div></div>
      )}

      <div style={{ display: 'grid', gap: 16 }}>
        {items.map((s) => {
          const email = s.draft?.email;
          const isEditing = editFile === s.file_number;
          return (
            <div className="card" key={s.file_number}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <div>
                  <span className="mono" style={{ fontWeight: 700, fontSize: 15 }}>{s.file_number}</span>
                  <span style={{ color: 'var(--muted)', marginInlineStart: 10 }}>{s.customer_name}</span>
                  {s.hazardous === 'Yes' && <span style={{ marginInlineStart: 10 }} title="חומר מסוכן">⚠</span>}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {s.draft?.needs_review && <span className="review-flag">דורש בדיקת פרטי קשר</span>}
                  {s.department && <span className="type-tag">{s.department.toUpperCase()}</span>}
                  <span className={'badge route-' + (s.route || 'alert')}>{s.route}</span>
                </div>
              </div>

              {email && (
                <div className="email-preview">
                  <div><span className="k">מאת: </span><span className="mono">{email.from}</span></div>
                  <div><span className="k">אל: </span><span className="mono">{email.to.join(', ')}</span></div>
                  <div><span className="k">עותק: </span><span className="mono">{email.cc.join(', ')}</span></div>
                  <div><span className="k">נושא: </span>{email.subject}</div>
                  {isEditing
                    ? <textarea rows={8} value={editBody} onChange={(e) => setEditBody(e.target.value)} />
                    : <pre>{email.body}</pre>}
                </div>
              )}

              <div className="row-actions" style={{ marginTop: 16 }}>
                {isEditing ? (
                  <>
                    <button className="btn primary" onClick={() => decide(s.file_number, 'edit', { body: editBody })}>שמירת עריכה</button>
                    <button className="btn" onClick={() => setEditFile(null)}>ביטול עריכה</button>
                  </>
                ) : (
                  <>
                    <button className="btn primary" onClick={() => decide(s.file_number, 'approve')}>✅ אישור ושליחה</button>
                    <button className="btn" onClick={() => startEdit(s)}>✏️ עריכה</button>
                    <button className="btn danger" onClick={() => decide(s.file_number, 'reject')}>❌ דחייה</button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
