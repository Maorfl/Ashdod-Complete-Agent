/**
 * FileModal — כרטיס תיק: פרטים מלאים, ציר-זמן היסטוריה, טיוטת מייל ופעולות.
 * נסגר ב-Escape ובלחיצה על הרקע. הפעולות זהות לאלה שבטבלת הדשבורד.
 */
import { useEffect, useRef, useState } from "react";
import { api, Shipment, HistoryEntry } from "../api";
import { statusKeyOf, statusLabel, STATUS_META, MANUAL_STATUSES, formatDateHe, formatDateTimeHe, requiresGatepass } from "../status";
import { useToast } from "./Toasts";
import ConfirmModal from "./ConfirmModal";
import ShipmentNotesModal from "./ShipmentNotesModal";
import EmailListEditor from "./EmailListEditor";

const ROUTE_LABELS: Record<string, string> = {
    co_loader: "CO-LOADER",
    terminal: "מסוף",
    prepaid: "PREPAID",
    direct: "ישיר",
    alert: "התראה",
    sent: "נשלח",
    reminder: "תזכורת",
};

export default function FileModal({
    item,
    onClose,
    onChanged,
}: {
    item: Shipment;
    onClose: () => void;
    onChanged: () => void;
}) {
    const toast = useToast();
    const [history, setHistory] = useState<HistoryEntry[] | null>(null);
    const [statusPick, setStatusPick] = useState("");
    const [showDeliverConfirm, setShowDeliverConfirm] = useState(false);
    const [statusToUpdate, setStatusToUpdate] = useState<string | null>(null);
    const [showNotesModal, setShowNotesModal] = useState(false);
    const [isEditingDraft, setIsEditingDraft] = useState(false);
    const [editBody, setEditBody] = useState("");
    const [savedBody, setSavedBody] = useState<string | null>(null);
    const [savingDraft, setSavingDraft] = useState(false);
    // עריכת נמענים — אפשרות זמנית: קיימת כי השליחה עדיין בשער אישור אנושי
    const [editTo, setEditTo] = useState<string[]>([]);
    const [editCc, setEditCc] = useState<string[]>([]);
    const [savedTo, setSavedTo] = useState<string[] | null>(null);
    const [savedCc, setSavedCc] = useState<string[] | null>(null);
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    async function onUploadGatepass(file: File) {
        setUploading(true);
        try {
            await api.uploadGatepass(item.file_number, file);
            toast("gatepass PDF צורף ✓", "success");
            onChanged(); // רענון כדי שכפתור השליחה ייפתח
            onClose();
        } catch (e: any) {
            toast(e.message, "error");
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    }

    useEffect(() => {
        api.history(item.file_number)
            .then(setHistory)
            .catch(() => setHistory([]));
    }, [item.file_number]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);

    const key = statusKeyOf(item);
    const meta = STATUS_META.find((m) => m.key === key);
    const email = item.draft?.email;
    // גוף הטיוטה להצגה: הערך שנשמר לאחרונה בכרטיס גובר עד שה-prop מתרענן
    const displayBody = savedBody ?? email?.body ?? "";
    const displayTo = savedTo ?? email?.to ?? [];
    const displayCc = savedCc ?? email?.cc ?? [];
    const canEditDraft = item.status === "pending_approval";

    async function performDeliver() {
        try {
            await api.updateStatus(item.file_number, "נמסר ללקוח");
            toast("התיק הועבר ללשונית נמסר ללקוח ✓", "success");
            onChanged();
            onClose();
        } catch (e: any) {
            toast(e.message, "error");
        } finally {
            setShowDeliverConfirm(false);
        }
    }

    async function performStatusUpdate(status: string) {
        try {
            await api.updateStatus(item.file_number, status);
            toast(`הסטטוס עודכן ל"${status}" ✓`, "success");
            onChanged();
            onClose();
        } catch (e: any) {
            toast(e.message, "error");
            setStatusPick("");
        } finally {
            setStatusToUpdate(null);
        }
    }

    function deliver() {
        setShowDeliverConfirm(true);
    }

    function changeStatus(status: string) {
        if (!status) return;
        setStatusToUpdate(status);
    }

    function openNotes() {
        setShowNotesModal(true);
    }

    // עריכה מתחילה תמיד מהטיוטה העדכנית ביותר בשרת (לא מ-prop שעלול להיות ישן),
    // כדי שלא לדרוס עריכה חדשה יותר שנשמרה במקום אחר. בכשל רשת נופלים למקומי.
    async function startEditDraft() {
        let body = displayBody, to = displayTo, cc = displayCc;
        try {
            const latest = await api.draft(item.file_number);
            const e = latest?.draft?.email;
            if (e) {
                body = e.body || ""; to = e.to || []; cc = e.cc || [];
                setSavedBody(body); setSavedTo(to); setSavedCc(cc);
            }
        } catch {
            toast("לא ניתן לרענן טיוטה מהשרת — נטענה הגרסה המקומית", "error");
        }
        setEditBody(body);
        setEditTo(to);
        setEditCc(cc);
        setIsEditingDraft(true);
    }

    function cancelEditDraft() {
        setIsEditingDraft(false);
    }

    async function saveDraft() {
        setSavingDraft(true);
        try {
            await api.decide(item.file_number, "edit", { body: editBody, to: editTo, cc: editCc });
            setSavedBody(editBody);
            setSavedTo(editTo);
            setSavedCc(editCc);
            setIsEditingDraft(false);
            toast("הטיוטה עודכנה ✓", "success");
            onChanged(); // רענון הרשימה בלי לסגור את הכרטיס
        } catch (e: any) {
            toast(e.message, "error"); // נשארים במצב עריכה כדי לא לאבד את הטקסט
        } finally {
            setSavingDraft(false);
        }
    }

    return (
        <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
            <div className="modal" role="dialog" aria-modal="true" aria-label={`כרטיס תיק ${item.file_number}`}>
                <div className="modal-head">
                    <div>
                        <span className="mono file-no">{item.file_number}</span>
                        <span className="modal-cust">{item.customer_name || "—"}</span>
                    </div>
                    <button className="x" onClick={onClose} aria-label="סגירה">
                        ×
                    </button>
                </div>

                <div className="modal-body">
                    <table className="details-table">
                        <tbody>
                            <tr>
                                <th>מספר תיק</th>
                                <td className="mono">{item.file_number}</td>
                            </tr>
                            <tr>
                                <th>לקוח</th>
                                <td>{item.customer_name || "—"}</td>
                            </tr>
                            <tr>
                                <th>סטטוס נוכחי</th>
                                <td>
                                    <span
                                        className="st-badge"
                                        style={{ ["--c" as any]: meta?.cssVar || "var(--muted)" }}
                                    >
                                        {statusLabel(item.status)}
                                    </span>
                                </td>
                            </tr>
                            <tr>
                                <th>תאריך שחרור</th>
                                <td className="mono"><span dir="ltr">{formatDateHe(item.release_date)}</span></td>
                            </tr>
                            <tr>
                                <th>עדכון סטטוס</th>
                                <td className="mono"><span dir="ltr">{formatDateTimeHe(item.status_updated_at)}</span></td>
                            </tr>
                            <tr>
                                <th>מסלול</th>
                                <td>{ROUTE_LABELS[item.route] || item.route || "—"}</td>
                            </tr>
                            <tr>
                                <th>מסוף שחרור</th>
                                <td>{item.site_des || "—"}</td>
                            </tr>
                            <tr>
                                <th>מוביל המשך</th>
                                <td>{item.continuation || "—"}</td>
                            </tr>
                            <tr>
                                <th>קוד קו-לואדר</th>
                                <td className="mono">{item.co_loader_code || "—"}</td>
                            </tr>
                            <tr>
                                <th>מחלקה / סוכן</th>
                                <td>
                                    {item.department ? item.department.toUpperCase() : "—"}
                                    {item.agent_name ? ` · ${item.agent_name}` : ""}
                                </td>
                            </tr>
                            <tr>
                                <th>חומר מסוכן</th>
                                <td>{item.hazardous === "Yes" ? "⚠ כן" : "לא"}</td>
                            </tr>
                            {requiresGatepass(item) && (
                                <tr>
                                    <th>gatepass PDF</th>
                                    <td>
                                        <span className={"gatepass-tag " + (item.gatepass_pdf_path ? "ok" : "pending")}>
                                            {item.gatepass_pdf_path ? "📎 PDF מצורף ✓" : "⚠ טרם התקבל PDF — חובה לשליחה"}
                                        </span>
                                        {!item.gatepass_pdf_path && (
                                            <div style={{ marginTop: 8 }}>
                                                <input
                                                    ref={fileInputRef}
                                                    type="file"
                                                    accept="application/pdf"
                                                    disabled={uploading}
                                                    aria-label="צירוף gatepass PDF"
                                                    onChange={(e) => {
                                                        const f = e.target.files?.[0];
                                                        if (f) onUploadGatepass(f);
                                                    }}
                                                />
                                                {uploading && <span style={{ marginInlineStart: 8 }}>מעלה…</span>}
                                                <div className="hint-line" style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>
                                                    לא ניתן לשלוח מייל ללא gatepass PDF. צרפו קובץ PDF ידנית או המתינו לקבלתו.
                                                </div>
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            )}
                            {item.notes && (
                                <tr>
                                    <th>הערות</th>
                                    <td>{item.notes}</td>
                                </tr>
                            )}
                        </tbody>
                    </table>

                    <h4 className="modal-sec">היסטוריית סטטוסים</h4>
                    {history === null && <div className="empty small">טוען היסטוריה…</div>}
                    {history !== null && history.length === 0 && (
                        <div className="empty small">אין רשומות היסטוריה לתיק זה.</div>
                    )}
                    {history !== null && history.length > 0 && (
                        <ol className="timeline">
                            {history.map((h) => (
                                <li key={h.id}>
                                    <div className="tl-dot" />
                                    <div className="tl-body">
                                        <div className="tl-status">{statusLabel(h.status)}</div>
                                        <div className="tl-time mono"><span dir="ltr">{formatDateTimeHe(h.changed_at)}</span></div>
                                        {h.notes && <div className="tl-notes">{h.notes}</div>}
                                    </div>
                                </li>
                            ))}
                        </ol>
                    )}

                    <h4 className="modal-sec">
                        טיוטת מייל{canEditDraft ? " (ממתינה לאישור)" : ""}
                    </h4>
                    {email ? (
                        <div className="email-preview">
                            <div>
                                <span className="k">מאת: </span>
                                <span className="mono">{email.from}</span>
                            </div>
                            {isEditingDraft ? (
                                <>
                                    <EmailListEditor label="אל (To)" emails={editTo} onChange={setEditTo} />
                                    <EmailListEditor label="עותק (CC)" emails={editCc} onChange={setEditCc} />
                                    <p className="hint-line" style={{ color: "var(--muted)", fontSize: 12 }}>
                                        עריכת נמענים — אפשרות זמנית כל עוד השליחה דורשת אישור ידני.
                                    </p>
                                </>
                            ) : (
                                <>
                                    <div>
                                        <span className="k">אל: </span>
                                        <span className="mono">{displayTo.join(", ")}</span>
                                    </div>
                                    <div>
                                        <span className="k">עותק: </span>
                                        <span className="mono">{displayCc.join(", ")}</span>
                                    </div>
                                </>
                            )}
                            <div>
                                <span className="k">נושא: </span>
                                {email.subject}
                            </div>
                            {isEditingDraft ? (
                                <>
                                    <textarea
                                        dir="rtl"
                                        rows={8}
                                        value={editBody}
                                        onChange={(e) => setEditBody(e.target.value)}
                                        aria-label="עריכת גוף הטיוטה"
                                        autoFocus
                                    />
                                    <div className="draft-edit-actions">
                                        <button className="btn primary" onClick={saveDraft} disabled={savingDraft}>
                                            {savingDraft ? "שומר…" : "שמירה"}
                                        </button>
                                        <button className="btn" onClick={cancelEditDraft} disabled={savingDraft}>
                                            ביטול
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <pre dir="rtl" className="email-body-preview">{displayBody}</pre>
                                    {canEditDraft && (
                                        <div className="draft-edit-actions">
                                            <button className="btn sm" onClick={startEditDraft}>
                                                ✏️ עריכת טיוטה
                                            </button>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    ) : (
                        <div className="empty small">אין טיוטת מייל זמינה לתיק זה.</div>
                    )}
                </div>

                <div className="modal-foot">
                    {item.status !== "נמסר ללקוח" && (
                        <button className="btn primary" onClick={deliver}>
                            ✅ סימון כנמסר
                        </button>
                    )}
                    <select
                        className="status-pick"
                        value={statusPick}
                        onChange={(e) => {
                            setStatusPick(e.target.value);
                            changeStatus(e.target.value);
                        }}
                        aria-label="עדכון סטטוס"
                    >
                        <option value="">🔄 עדכון סטטוס</option>
                        {MANUAL_STATUSES.map((s) => (
                            <option key={s} value={s}>
                                {s}
                            </option>
                        ))}
                    </select>
                    <button className="btn" onClick={openNotes}>
                        📝 הערות לתיק
                    </button>
                    <button className="btn ghost" onClick={onClose} style={{ marginInlineStart: "auto" }}>
                        סגירה
                    </button>
                </div>
                {showDeliverConfirm && (
                    <ConfirmModal
                        title={`סימון כנמסר — תיק ${item.file_number}`}
                        confirmLabel="אשר"
                        onConfirm={performDeliver}
                        onCancel={() => setShowDeliverConfirm(false)}
                    >
                        לסמן תיק {item.file_number} כנמסר ללקוח?
                    </ConfirmModal>
                )}

                {statusToUpdate && (
                    <ConfirmModal
                        title={`עדכון סטטוס — תיק ${item.file_number}`}
                        confirmLabel="עדכן"
                        onConfirm={() => performStatusUpdate(statusToUpdate)}
                        onCancel={() => {
                            setStatusPick("");
                            setStatusToUpdate(null);
                        }}
                    >
                        לעדכן את תיק {item.file_number} לסטטוס "{statusToUpdate}"?
                    </ConfirmModal>
                )}

                {showNotesModal && (
                    <ShipmentNotesModal
                        item={item}
                        onCancel={() => setShowNotesModal(false)}
                        onSaved={() => {
                            setShowNotesModal(false);
                            onChanged();
                            onClose();
                        }}
                    />
                )}
            </div>
        </div>
    );
}
