import { useEffect, useMemo, useState } from 'react';
import { api, Shipment } from '../api';
import { useAgentFilter, matchesAgent } from '../context/AgentFilterContext';
import ConfirmModal from '../components/ConfirmModal';
import EmailListEditor from '../components/EmailListEditor';

export default function Approvals() {
  const { agent } = useAgentFilter();
  const [allItems, setAllItems] = useState<Shipment[]>([]);
  const items = useMemo(() => allItems.filter((s) => matchesAgent(s, agent)), [allItems, agent]);
  const [flash, setFlash] = useState<{ t: string; ok: boolean } | null>(null);
  const [editFile, setEditFile] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');
  // עריכת נמענים — אפשרות זמנית: קיימת כי השליחה עדיין בשער אישור אנושי
  const [editTo, setEditTo] = useState<string[]>([]);
  const [editCc, setEditCc] = useState<string[]>([]);
  const [activeApproveItem, setActiveApproveItem] = useState<Shipment | null>(null);
  const [activeRejectItem, setActiveRejectItem] = useState<Shipment | null>(null);
  const [rejectNotes, setRejectNotes] = useState('');

  function load() { api.approvals().then(setAllItems).catch((e) => setFlash({ t: e.message, ok: false })); }
  useEffect(load, []);

  async function decide(file: string, decision: string, edited?: any, notes?: string) {
    try {
      const res: any = await api.decide(file, decision, edited, notes);
      if (decision === 'approve') {
        // אמת מול המשתמש: נשלח בפועל רק אם Microsoft Graph מחובר (res.sent)
        setFlash(res?.sent
          ? { t: 'אושר ונשלח מ-ashdod.agent@h-caspi.co.il ✓', ok: true }
          : { t: 'אושר וסומן כ"נשלח" — אך Microsoft Graph אינו מחובר, ולכן לא נשלח מייל בפועל. הגדירו GRAPH_* בקובץ server/.env.', ok: false });
      } else {
        setFlash({ t: decision === 'reject' ? 'הבקשה נדחתה' : 'הטיוטה עודכנה', ok: true });
      }
      setEditFile(null);
      load();
    } catch (e: any) { setFlash({ t: e.message, ok: false }); }
  }

  // עריכה מתחילה תמיד מהטיוטה העדכנית ביותר בשרת — לשונית האישורים אינה מתרעננת
  // אוטומטית, כך שהעותק בזיכרון עלול להיות ישן. שמירה על בסיס ישן הייתה דורסת
  // עריכה חדשה יותר. בכשל רשת נופלים לגרסה המקומית עם אזהרה.
  async function startEdit(s: Shipment) {
    let email = s.draft?.email;
    try {
      const latest = await api.draft(s.file_number);
      if (latest?.draft?.email) email = latest.draft.email;
    } catch { setFlash({ t: 'לא ניתן לרענן טיוטה מהשרת — נטענה הגרסה המקומית', ok: false }); }
    setEditFile(s.file_number);
    setEditBody(email?.body || '');
    setEditTo(email?.to || []);
    setEditCc(email?.cc || []);
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
                  {(s.route === 'co_loader' || s.route === 'terminal') && (
                    <span className={'gatepass-tag ' + (s.gatepass_pdf_path ? 'ok' : 'pending')}>
                      {s.gatepass_pdf_path ? '📎 PDF מצורף ✓' : '⚠ טרם התקבל PDF'}
                    </span>
                  )}
                  {s.real_recipients && <span className="review-flag" title="אישור ישלח מייל אמיתי לנמען אמיתי — לא לכתובת ה-override">📮 נמענים אמיתיים</span>}
                  {s.draft?.needs_review && <span className="review-flag">דורש בדיקת פרטי קשר</span>}
                  {s.department && <span className="type-tag">{s.department.toUpperCase()}</span>}
                  <span className={'badge route-' + (s.route || 'alert')}>{s.route}</span>
                </div>
              </div>

              {email && (
                <div className="email-preview">
                  <div><span className="k">מאת: </span><span className="mono">{email.from}</span></div>
                  {isEditing ? (
                    <>
                      <EmailListEditor label="אל (To)" emails={editTo} onChange={setEditTo} />
                      <EmailListEditor label="עותק (CC)" emails={editCc} onChange={setEditCc} />
                      <p className="hint-line" style={{ color: 'var(--muted)', fontSize: 12 }}>
                        עריכת נמענים — אפשרות זמנית כל עוד השליחה דורשת אישור ידני.
                      </p>
                    </>
                  ) : (
                    <>
                      <div><span className="k">אל: </span><span className="mono">{email.to.join(', ')}</span></div>
                      <div><span className="k">עותק: </span><span className="mono">{email.cc.join(', ')}</span></div>
                    </>
                  )}
                  <div><span className="k">נושא: </span>{email.subject}</div>
                  {isEditing
                    ? <textarea rows={8} value={editBody} onChange={(e) => setEditBody(e.target.value)} />
                    : <pre dir="rtl">{email.body}</pre>}
                </div>
              )}

              <div className="row-actions" style={{ marginTop: 16 }}>
                {isEditing ? (
                  <>
                    <button className="btn primary" onClick={() => decide(s.file_number, 'edit', { body: editBody, to: editTo, cc: editCc })}>שמירת עריכה</button>
                    <button className="btn" onClick={() => setEditFile(null)}>ביטול עריכה</button>
                  </>
                ) : (
                  <>
                    <button className="btn primary" onClick={() => setActiveApproveItem(s)}>✅ אישור ושליחה</button>
                    <button className="btn" onClick={() => startEdit(s)}>✏️ עריכה</button>
                    <button className="btn danger" onClick={() => { setActiveRejectItem(s); setRejectNotes(''); }}>❌ דחייה</button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {activeApproveItem && (
        <ConfirmModal
          title={`אישור ושליחה — תיק ${activeApproveItem.file_number}`}
          confirmLabel="אשר ושלח"
          onConfirm={async () => {
            const file = activeApproveItem.file_number;
            setActiveApproveItem(null);
            await decide(file, 'approve');
          }}
          onCancel={() => setActiveApproveItem(null)}
        >
          <table className="details-table" style={{ width: '100%', marginBottom: 14 }}>
            <tbody>
              <tr><th>תיק</th><td className="mono">{activeApproveItem.file_number}</td></tr>
              <tr><th>לקוח</th><td>{activeApproveItem.customer_name || '—'}</td></tr>
              <tr><th>אל (To)</th><td className="mono">{activeApproveItem.draft?.email.to.join(', ') || '—'}</td></tr>
              <tr><th>עותק (CC)</th><td className="mono">{activeApproveItem.draft?.email.cc.join(', ') || '—'}</td></tr>
              <tr><th>נושא</th><td>{activeApproveItem.draft?.email.subject || '—'}</td></tr>
            </tbody>
          </table>
          <p className="hint-line" style={{ color: 'var(--st-alert)', fontWeight: 'bold' }}>
            המייל יישלח מ-ashdod.agent@h-caspi.co.il
          </p>
          {activeApproveItem.real_recipients && (
            <p className="hint-line" style={{ color: 'var(--st-alert)', fontWeight: 'bold' }}>
              ⚠ טיוטה זו נושאת נמענים אמיתיים — המייל יגיע ללקוח/למוביל בפועל, לא לכתובת הבדיקה.
            </p>
          )}
        </ConfirmModal>
      )}

      {activeRejectItem && (
        <ConfirmModal
          title={`דחיית טיוטה — תיק ${activeRejectItem.file_number}`}
          confirmLabel="דחה"
          danger={true}
          onConfirm={async () => {
            const file = activeRejectItem.file_number;
            const notes = rejectNotes;
            setActiveRejectItem(null);
            await decide(file, 'reject', undefined, notes);
          }}
          onCancel={() => setActiveRejectItem(null)}
        >
          <p>האם אתה בטוח שברצונך לדחות את טיוטת המייל לתיק {activeRejectItem.file_number}?</p>
          <div className="field" style={{ marginTop: 12 }}>
            <label htmlFor="rej-notes">סיבת דחייה / הערה (לא חובה)</label>
            <textarea
              id="rej-notes"
              rows={3}
              value={rejectNotes}
              onChange={(e) => setRejectNotes(e.target.value)}
              placeholder="הקלד סיבת דחייה..."
              autoFocus
            />
          </div>
        </ConfirmModal>
      )}
    </>
  );
}
