/**
 * SentEmails — "מיילים שנשלחו": לוג היסטורי של כל מייל שנשלח בפועל דרך Graph
 * (אישור אנושי או שליחה אוטומטית). מוזן מטבלת sent_emails הייעודית — לא מטיוטות.
 */
import { useEffect, useState } from 'react';
import { api, SentEmail } from '../api';
import { formatDateTimeHe } from '../status';

export default function SentEmails() {
  const [items, setItems] = useState<SentEmail[] | null>(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    api.sentEmails().then(setItems).catch((e) => setErr(e.message));
  }, []);

  const needle = q.trim().toLowerCase();
  const visible = (items || []).filter((m) =>
    !needle ||
    String(m.file_number || '').toLowerCase().includes(needle) ||
    String(m.customer_name || '').toLowerCase().includes(needle) ||
    String(m.subject || '').toLowerCase().includes(needle));

  return (
    <>
      <div className="page-head">
        <h1>מיילים שנשלחו</h1>
        <p>העתק היסטורי מדויק של כל מייל שנשלח בפועל — כולל נמענים, נושא וגוף. {items ? `${items.length} רשומות.` : ''}</p>
      </div>

      {err && <div className="flash err">{err} — ודאו שהשרת פעיל (npm start).</div>}

      <div className="filter-bar">
        <div className="search"><input placeholder="חיפוש לפי מספר תיק, לקוח או נושא…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>

      {items === null && !err && <div className="card"><div className="empty"><div className="big">⏳</div>טוען…</div></div>}
      {items !== null && visible.length === 0 && (
        <div className="card"><div className="empty"><div className="big">📭</div>{items.length === 0 ? 'טרם נשלחו מיילים.' : 'אין תוצאות לחיפוש הנוכחי.'}</div></div>
      )}

      {visible.map((m) => (
        <div className="card" key={m.id} style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            <div>
              <b className="mono">{m.file_number}</b>
              {m.customer_name && <span style={{ marginInlineStart: 8 }}>{m.customer_name}</span>}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {m.auto ? <span className="badge">⚡ נשלח אוטומטית</span> : <span className="badge">אושר ידנית</span>}
              {m.route && <span className={'badge route-' + m.route}>{m.route}</span>}
              <span className="mono" dir="ltr" style={{ color: 'var(--muted)', fontSize: 12 }}>{formatDateTimeHe(m.sent_at)}</span>
            </div>
          </div>
          <div className="email-preview">
            <div><span className="k">מאת: </span><span className="mono">{m.from_address || '—'}</span></div>
            <div><span className="k">אל: </span><span className="mono">{m.to_addresses.join(', ') || '—'}</span></div>
            <div><span className="k">עותק: </span><span className="mono">{m.cc_addresses.join(', ') || '—'}</span></div>
            <div><span className="k">נושא: </span>{m.subject || '—'}</div>
            <pre dir="rtl">{m.body || ''}</pre>
          </div>
        </div>
      ))}
    </>
  );
}
