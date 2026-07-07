const BASE = '/api';

async function req<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(BASE + url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(e.error || 'שגיאת שרת');
  }
  return res.json();
}

export interface Importer {
  _folder?: string;
  name: string;
  company_id: string;
  emails: string[];
  address: string;
  notes: string;
  department: string;
  service_rep: string;
  type: string;
  dangerous_rule: boolean;
  cont_general: string;
  cont_general_emails: string[];
  cont_dangerous_emails: string[];
  aliases: string[];
  seen_stations?: string[];
  files?: string[];
}

export interface DraftEmail {
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
}

export interface Draft {
  route: string;
  needs_review?: boolean;
  email: DraftEmail;
  alerts?: any[];
}

export interface Shipment {
  file_number: string;
  customer_name: string;
  status: string;
  status_updated_at: string;
  release_date: string;
  notes: string;
  agent_name: string;
  route: string;
  reason: string;
  department: string;
  co_loader_code: string;
  continuation: string;
  transfer_performer?: string | null; // מבצע העברה לחיפה: קו-לואדר / משלח לא-כספי / מסוף
  hazardous: string;
  type: string;
  gatepass_pdf_path?: string | null;
  auto_sent?: number; // 1 = נשלח אוטומטית (העברה לחיפה) ללא אישור אנושי (Task 6)
  whitelisted?: boolean; // מחושב בשרת (scope.js): האם הלקוח ברשימת CUS1 — defense in depth
  real_recipients?: boolean; // הטיוטה נושאת נמענים אמיתיים (לא override) — אישור ישלח מייל אמיתי
  draft?: Draft | null;
}

// לוג "מיילים שנשלחו" — העתק היסטורי מדויק של כל מייל שנשלח בפועל (append-only)
export interface SentEmail {
  id: number;
  file_number: string;
  customer_name: string | null;
  route: string | null;
  from_address: string | null;
  to_addresses: string[];
  cc_addresses: string[];
  subject: string | null;
  body: string | null;
  auto: number; // 1 = נשלח אוטומטית
  sent_at: string;
}

export interface HistoryEntry {
  id: number;
  file_number: string;
  status: string;
  changed_at: string;
  notes: string | null;
}

export interface DashboardCounts {
  pending_approval: number;
  released_ashdod: number;
  to_haifa: number;
  delivered: number;
  alert: number;
}

export const api = {
  health: () => req<{ ok: boolean }>('/health'),
  version: () => req<{ current: string; latest: string; update_required: boolean; source: string }>('/version'),

  importers: () => req<Importer[]>('/importers'),
  importer: (folder: string) => req<Importer>('/importers/' + encodeURIComponent(folder)),
  createImporter: (data: Partial<Importer>) => req<Importer>('/importers', { method: 'POST', body: JSON.stringify(data) }),
  updateImporter: (folder: string, data: Partial<Importer>) =>
    req<Importer>('/importers/' + encodeURIComponent(folder), { method: 'PUT', body: JSON.stringify(data) }),
  deleteImporter: (folder: string) => req<{ ok: boolean }>('/importers/' + encodeURIComponent(folder), { method: 'DELETE' }),

  dashboard: () => req<{ counts: DashboardCounts; total: number; items: Shipment[] }>('/shipments'),
  approvals: () => req<Shipment[]>('/approvals'),
  sentEmails: () => req<SentEmail[]>('/sent-emails'),
  decide: (file: string, decision: string, edited?: Partial<DraftEmail>, notes?: string) =>
    req('/approvals/' + encodeURIComponent(file) + '/decision', {
      method: 'POST',
      body: JSON.stringify({ decision, edited, notes }),
    }),
  runWatcher: () => req<Record<string, unknown>>('/version/watcher/run', { method: 'POST' }),

  history: (file: string) => req<HistoryEntry[]>('/shipments/' + encodeURIComponent(file) + '/history'),
  updateStatus: (file: string, status: string, notes?: string) =>
    req<{ ok: boolean; status: string }>('/shipments/' + encodeURIComponent(file) + '/status', {
      method: 'POST',
      body: JSON.stringify({ status, notes }),
    }),
  createReminder: (file: string, notes?: string) =>
    req<{ ok: boolean; status: string; email: DraftEmail }>('/shipments/' + encodeURIComponent(file) + '/reminder', {
      method: 'POST',
      body: JSON.stringify({ notes }),
    }),
  updateShipmentNotes: (file: string, notes: string) =>
    req<{ ok: boolean; notes: string }>('/shipments/' + encodeURIComponent(file) + '/notes', {
      method: 'POST',
      body: JSON.stringify({ notes }),
    }),
  fetchGatepass: (file: string) =>
    req<{ ok: boolean; path?: string; skipped?: string }>('/shipments/' + encodeURIComponent(file) + '/gatepass', {
      method: 'POST',
    }),
};
