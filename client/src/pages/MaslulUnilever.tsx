/**
 * MaslulUnilever — מחולל קובץ הייבוא למסלול עבור יוניליוור (CUS1).
 *
 * ארבעה אזורים: העלאה -> סקירה -> אישור ניחושים -> הפקה, בתוספת היסטוריית ריצות.
 * שום קובץ xlsx אינו נוצר לפני לחיצה על "אשר והפק קובץ".
 * העמוד אינו נוגע במיילים/תיקים/אישורי שליחה, ומתעלם ממסנן הסוכן הגלובלי.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { maslul, MaslulJob, MaslulReview, MaslulRow } from '../api';
import ConfirmModal from '../components/ConfirmModal';
import { useToast } from '../components/Toasts';

const COLS: { key: 'A' | 'B' | 'C' | 'D'; label: string }[] = [
  { key: 'A', label: 'פרט מכס' },
  { key: 'B', label: 'קוד דגם' },
  { key: 'C', label: 'תיאור' },
  { key: 'D', label: 'כמות' },
];

function badge(status?: string) {
  if (status === 'verified') return <span className="ms-badge ok" title="מאומת">✅</span>;
  if (status === 'guess') return <span className="ms-badge warn" title="ניחוש — דורש אישור">⚠️</span>;
  if (status === 'blocked') return <span className="ms-badge bad" title="חסום — לא ניתן להפיק">⛔</span>;
  return <span className="ms-badge" title="לא נכתב">—</span>;
}

/** ערכי טקסט מוצגים במרכאות כדי שרווחים יהיו גלויים (מפרט §8) */
function q(v: unknown) {
  return v === null || v === undefined || v === '' ? '—' : `"${v}"`;
}

export default function MaslulUnilever() {
  const toast = useToast();
  const [invoice, setInvoice] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<MaslulJob | null>(null);
  const [review, setReview] = useState<MaslulReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [approved, setApproved] = useState<Record<string, string>>({});   // sku -> model שאושר
  const [edits, setEdits] = useState<Record<string, string>>({});          // sku -> עריכה ידנית
  const [confirmGen, setConfirmGen] = useState(false);
  const [confirmClearHistory, setConfirmClearHistory] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [history, setHistory] = useState<MaslulJob[]>([]);
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [showExcluded, setShowExcluded] = useState(false);
  const invoiceRef = useRef<HTMLInputElement | null>(null);

  const loadHistory = useCallback(() => {
    maslul.jobs().then(setHistory).catch(() => setHistory([]));
  }, []);
  useEffect(loadHistory, [loadHistory]);

  // סקר התקדמות בזמן ניתוח (OCR לוקח שניות) — פשוט יותר מ-SSE בקודבייס הזה
  useEffect(() => {
    if (!jobId) return;
    let stop = false;
    const tick = async () => {
      try {
        const j = await maslul.job(jobId);
        if (stop) return;
        setJob(j);
        if (j.status === 'analyzing') { setTimeout(tick, 1200); return; }
        setReview(j.review || null);
        setBusy(false);
        loadHistory();
        if (j.status === 'error') toast(j.error || 'הניתוח נכשל', 'error');
      } catch (e: any) {
        if (!stop) { setBusy(false); toast(e.message, 'error'); }
      }
    };
    tick();
    return () => { stop = true; };
  }, [jobId, toast, loadHistory]);

  async function analyze() {
    if (!invoice) { toast('נא לבחור חשבון ספק (PDF)', 'error'); return; }
    setBusy(true); setReview(null); setJob(null); setApproved({}); setEdits({});
    try {
      const { job_id } = await maslul.upload(invoice);
      setJobId(job_id);
    } catch (e: any) {
      setBusy(false);
      toast(e.message, 'error');
    }
  }

  /** ניקוי — מאפס את המסך ואת הקבצים שנבחרו. אינו מוחק ריצות מההיסטוריה. */
  function reset() {
    setInvoice(null);
    setJobId(null);
    setJob(null);
    setReview(null);
    setApproved({});
    setEdits({});
    setOpenRow(null);
    setShowExcluded(false);
    if (invoiceRef.current) invoiceRef.current.value = '';
  }

  async function clearHistory() {
    setConfirmClearHistory(false);
    try {
      const r = await maslul.clearJobs();
      toast(`ההיסטוריה נוקתה (${r.deleted} ריצות)`, 'success');
      reset();
      loadHistory();
    } catch (e: any) { toast(e.message, 'error'); }
  }

  async function deleteJob(id: string) {
    setConfirmDelete(null);
    try {
      await maslul.deleteJob(id);
      toast('הריצה נמחקה', 'success');
      if (id === jobId) reset();
      loadHistory();
    } catch (e: any) { toast(e.message, 'error'); }
  }

  async function openJob(id: string) {
    setBusy(true);
    try {
      const j = await maslul.job(id);
      setJobId(id); setJob(j); setReview(j.review || null);
      setApproved({}); setEdits({});
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function doGenerate() {
    if (!jobId || !review) return;
    setConfirmGen(false); setBusy(true);
    const approvals = Object.entries(approved).map(([sku, model]) => ({ sku, model }));
    const manual: Record<string, { B: string }> = {};
    for (const [sku, B] of Object.entries(edits)) if (B.trim()) manual[sku] = { B: B.trim() };
    try {
      const res = await maslul.generate(jobId, { approvals, manual });
      if (!res.ok) {
        toast('ההפקה נחסמה — ראו שגיאות', 'error');
        setReview({ ...review, errors: res.errors || [], blocked: true });
      } else {
        toast(`הקובץ הופק: ${res.output}`, 'success');
        const j = await maslul.job(jobId);
        setJob(j); loadHistory();
      }
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  }

  const guessRows = (review?.rows || []).filter((r) => r.guess);
  const canGenerate = review && !review.blocked && job?.status !== 'generated';

  function effectiveB(r: MaslulRow) {
    if (edits[r.sku] !== undefined && edits[r.sku].trim()) return edits[r.sku].trim();
    if (approved[r.sku]) return approved[r.sku];
    return r.B;
  }

  return (
    <div>
      <div className="page-head">
        <h1>יוניליוור · מחולל קובץ למסלול</h1>
        <div className="sub">חשבון ספק (PDF) ← קובץ ייבוא לבקשת אישור תקן. ההפקה רק אחרי סקירה ואישור.</div>
      </div>

      {/* 1 — העלאה */}
      <div className="card">
        <div className="toolbar" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div className="field" style={{ minWidth: 280 }}>
            <label>חשבון ספק (PDF) — חובה</label>
            <input ref={invoiceRef} type="file" accept="application/pdf" disabled={busy}
              onChange={(e) => setInvoice(e.target.files?.[0] || null)} />
          </div>
          <button className="btn primary" onClick={analyze} disabled={busy || !invoice}>
            {busy && job?.status === 'analyzing' ? 'מנתח…' : 'נתח חשבון'}
          </button>
          <button className="btn" onClick={reset} disabled={busy || (!invoice && !review && !job)}>
            ניקוי
          </button>
        </div>
        {job?.status === 'analyzing' && (
          <div className="hint-line" style={{ marginTop: 8 }}>
            {job.stage_detail || 'מנתח…'}
          </div>
        )}
      </div>

      {/* באנר חסימה */}
      {review && review.blocked && (
        <div className="card ms-blocked">
          <b>⛔ ההפקה חסומה</b>
          <ul>
            {review.errors.map((e, i) => (
              <li key={i}><span className="mono">{e.code}</span> — {e.message}</li>
            ))}
            {(review.rows || []).filter((r) => r.blocked).map((r, i) => (
              <li key={'r' + i}><span className="mono">{r.sku}</span> — {r.notes.join('; ')}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 2 — סקירה */}
      {review && review.rows.length > 0 && (
        <div className="card">
          <div className="ms-checks">
            <div className="ok">
              נוספו <b>{review.rows.length}</b> שורות
              {review.excluded.length > 0 && <> (הוחרגו {review.excluded.length})</>}
            </div>
          </div>

          <table className="tbl ms-table">
            <thead>
              <tr>
                <th>שורה בחשבון</th><th>SKU</th>
                {COLS.map((c) => <th key={c.key}>{c.label}</th>)}
                <th>סטטוס</th>
              </tr>
            </thead>
            <tbody>
              {review.rows.map((r, i) => (
                <>
                  <tr key={r.sku + i} className={r.blocked ? 'ms-row-blocked' : ''}>
                    <td className="mono">{r.item_no}</td>
                    <td className="mono">{r.sku}</td>
                    <td>{q(r.A)} {badge(r.status.A)}</td>
                    <td>{q(effectiveB(r))} {badge(edits[r.sku]?.trim() || approved[r.sku] ? 'verified' : r.status.B)}</td>
                    <td>{q(r.C)} {badge(r.status.C)}</td>
                    <td className="mono">{r.D ?? '—'} {badge(r.status.D)}</td>
                    <td>
                      <button className="btn sm" onClick={() => setOpenRow(openRow === i ? null : i)}>
                        {openRow === i ? 'סגור' : 'מקור'}
                      </button>
                    </td>
                  </tr>
                  {openRow === i && (
                    <tr key={r.sku + i + '-src'}>
                      <td colSpan={7} className="ms-src">
                        {r.crop && jobId && <img src={maslul.cropUrl(jobId, i)} alt={`שורה ${r.sku}`} />}
                        <div className="mono ms-raw">{r.raw?.itemLine}</div>
                        <div className="mono ms-raw">{r.raw?.qtyLine}</div>
                        {r.notes.length > 0 && <ul className="ms-notes">{r.notes.map((n, k) => <li key={k}>{n}</li>)}</ul>}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>

          {review.excluded.length > 0 && (
            <div className="ms-excluded">
              <button className="btn sm" onClick={() => setShowExcluded(!showExcluded)}>
                {showExcluded ? '▾' : '▸'} שורות שהוחרגו ({review.excluded.length})
              </button>
              {showExcluded && (
                <ul>
                  {review.excluded.map((e, i) => (
                    <li key={i}>
                      <span className="mono">{e.sku}</span> {q(e.description)} — כלל <span className="mono">{e.rule}</span> (<span className="mono">{e.pattern}</span>)
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {/* 3 — אישור ניחושים */}
      {guessRows.length > 0 && (
        <div className="card">
          <h3>ניחושי קוד דגם — דורשים אישור</h3>
          <div className="hint-line">אישור מקדם את הערך ל"מאומת" בפרופיל בעת ההפקה. ללא אישור הערך יופק ויישאר מסומן ⚠️.</div>
          {guessRows.map((r) => {
            const val = edits[r.sku] !== undefined ? edits[r.sku] : (approved[r.sku] ?? r.B ?? '');
            const len = val.length;
            const bad = len > 35 || !/^[\x20-\x7E]*$/.test(val);
            return (
              <div key={r.sku} className="ms-guess">
                <div><b className="mono">{r.sku}</b></div>
                <div>תיאור מלא מהחשבון: <span className="mono">{q(r.guess?.description)}</span></div>
                {r.guess?.removedTokens?.length ? (
                  <div>טוקנים שהוסרו: <span className="mono">{r.guess.removedTokens.join(', ')}</span>{r.guess.lengthTrimmed ? ' (כולל חיתוך לפי אורך)' : ''}</div>
                ) : null}
                <div className="ms-guess-row">
                  <input
                    value={val}
                    onChange={(e) => setEdits({ ...edits, [r.sku]: e.target.value })}
                    className={bad ? 'invalid' : ''}
                    maxLength={60}
                  />
                  <span className={'mono ' + (bad ? 'bad' : '')}>{len}/35</span>
                  <button
                    className={'btn sm' + (approved[r.sku] ? ' primary' : '')}
                    disabled={bad || !val.trim()}
                    onClick={() => setApproved({ ...approved, [r.sku]: val.trim() })}
                  >
                    {approved[r.sku] ? 'אושר ✓' : 'אשר'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 4 — הפקה */}
      {review && review.rows.length > 0 && (
        <div className="card">
          <div className="toolbar">
            <button className="btn primary" disabled={!canGenerate || busy} onClick={() => setConfirmGen(true)}>
              אשר והפק קובץ
            </button>
            {job?.status === 'generated' && jobId && (
              <a className="btn" href={maslul.outputUrl(jobId)}>הורדת {job.output}</a>
            )}
          </div>
        </div>
      )}

      {/* היסטוריה */}
      <div className="card">
        <div className="toolbar" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>היסטוריית ריצות</h3>
          {history.length > 0 && (
            <button className="btn danger sm" onClick={() => setConfirmClearHistory(true)} disabled={busy}>
              ניקוי היסטוריה
            </button>
          )}
        </div>
        {history.length === 0 ? <div className="empty">אין ריצות עדיין.</div> : (
          <table className="tbl">
            <thead><tr><th>תאריך</th><th>חשבון</th><th>שורות</th><th>סטטוס</th><th>פעולות</th></tr></thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.job_id}>
                  <td className="mono">{new Date(h.created_at).toLocaleString('he-IL')}</td>
                  <td className="mono">{h.invoice_no || h.invoice_name || '—'}</td>
                  <td className="mono">{h.rows ?? '—'}{h.excluded ? ` (−${h.excluded})` : ''}</td>
                  <td>{h.status}</td>
                  <td>
                    <button className="btn sm" onClick={() => openJob(h.job_id)}>פתח</button>
                    {h.output && <a className="btn sm" href={maslul.outputUrl(h.job_id)}>הורדה</a>}
                    <button className="btn sm danger" onClick={() => setConfirmDelete(h.job_id)}>מחק</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {confirmDelete && (
        <ConfirmModal
          title="מחיקת ריצה"
          confirmLabel="מחק"
          danger
          onConfirm={() => deleteJob(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        >
          הריצה וכל תוכנה יימחקו לצמיתות. הפעולה אינה הפיכה.
        </ConfirmModal>
      )}

      {confirmClearHistory && (
        <ConfirmModal
          title="ניקוי היסטוריית ריצות"
          confirmLabel="מחק הכל"
          danger
          onConfirm={clearHistory}
          onCancel={() => setConfirmClearHistory(false)}
        >
          יימחקו <b>{history.length}</b> ריצות על כל תוכנן — כולל החשבונות שהועלו והקבצים שהופקו.
          הפעולה אינה הפיכה. הפרופיל (קודי הדגם שאושרו) לא ייפגע.
        </ConfirmModal>
      )}

      {confirmGen && review && (
        <ConfirmModal
          title="הפקת קובץ ייבוא למסלול"
          confirmLabel="הפק"
          onConfirm={doGenerate}
          onCancel={() => setConfirmGen(false)}
        >
          יופקו <b>{review.rows.length}</b> שורות. יקודמו <b>{Object.keys(approved).length}</b> אישורי קוד דגם בפרופיל.
          תבנית: <span className="mono">{job?.template_name || review.template}</span>.
        </ConfirmModal>
      )}
    </div>
  );
}
