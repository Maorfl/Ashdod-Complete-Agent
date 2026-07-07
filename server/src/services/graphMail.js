/**
 * services/graphMail.js — חיבור Microsoft Graph (Outlook) בתצורת client-credentials.
 * אפס תלות חיצונית — fetch מובנה של Node. אפס תלות ב-LLM.
 *
 * שליחה בפועל מתבצעת רק מנקודת האישור האנושי (routes/approvals) — לעולם לא ישירות.
 * הסוד ניתן ל-override דרך env GRAPH_CLIENT_SECRET (עדיף על שמירה ב-config).
 */
const fs = require('fs');
const path = require('path');
const { config } = require('../config');

const GRAPH = 'https://graph.microsoft.com/v1.0';

function settings() {
  const g = config.microsoft_graph || {};
  return {
    enabled: !!g.enabled,
    tenantId: process.env.GRAPH_TENANT_ID || g.tenant_id,
    clientId: process.env.GRAPH_CLIENT_ID || g.client_id,
    clientSecret: process.env.GRAPH_CLIENT_SECRET || g.client_secret,
    sendOnApprove: g.send_on_approve !== false,
    pollMinutes: Number(g.poll_inbox_minutes || 5),
    gatepassLookbackDays: Number(g.gatepass_lookback_days || 14),
  };
}

function isEnabled() {
  const s = settings();
  return s.enabled && !!(s.tenantId && s.clientId && s.clientSecret);
}

// --- token (cached עד דקה לפני פקיעה) ---
let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry - 60000) return cachedToken;
  const s = settings();
  const res = await fetch(`https://login.microsoftonline.com/${s.tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: s.clientId,
      client_secret: s.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Graph token failed: ${data.error} — ${data.error_description || ''}`);
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
  return cachedToken;
}

async function graphFetch(path, opts = {}) {
  const token = await getToken();
  const res = await fetch(GRAPH + path, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (res.status === 202 || res.status === 204) return null; // sendMail / markRead
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data?.error?.message || res.statusText;
    throw new Error(`Graph ${res.status}: ${msg}`);
  }
  return data;
}

const rcpt = (addr) => ({ emailAddress: { address: addr } });

/**
 * שליחת מייל מתיבת השולח (sender_mailbox). email = { to[], cc[], subject, body }.
 * ה-To החיצוני כבר עבר override במסווג — כאן רק משגרים.
 */
async function sendMail(email) {
  const from = email.from || config.sender_mailbox;
  // צרופות: מערך נתיבי קבצים מקומיים (למשל gatepass PDF). מוטמעים כ-fileAttachment.
  const attachments = (email.attachments || [])
    .filter((p) => p && fs.existsSync(p))
    .map((p) => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: path.basename(p),
      contentType: 'application/pdf',
      contentBytes: fs.readFileSync(p).toString('base64'),
    }));
  const message = {
    subject: email.subject || '',
    // כאשר קיים bodyHtml — נשלח כ-HTML (Arial/12pt/RTL); אחרת טקסט רגיל
    body: email.bodyHtml
      ? { contentType: 'HTML', content: email.bodyHtml }
      : { contentType: 'Text', content: email.body || '' },
    toRecipients: (email.to || []).map(rcpt),
    ccRecipients: (email.cc || []).map(rcpt),
  };
  if (attachments.length) message.attachments = attachments;
  await graphFetch(`/users/${encodeURIComponent(from)}/sendMail`, {
    method: 'POST',
    body: JSON.stringify({ message, saveToSentItems: true }),
  });
  return { ok: true, from, to: email.to, attached: attachments.length, at: new Date().toISOString() };
}

/** הודעות שלא נקראו בתיבת הנכנס — למעקב הגעות לחיפה (מצב 2) */
async function listUnread(mailbox, top = 25) {
  const mb = encodeURIComponent(mailbox || config.sender_mailbox);
  const data = await graphFetch(
    `/users/${mb}/mailFolders/inbox/messages?$filter=isRead eq false&$top=${top}` +
    `&$select=id,subject,from,receivedDateTime,bodyPreview,body`
  );
  return data?.value || [];
}

async function markRead(mailbox, messageId) {
  const mb = encodeURIComponent(mailbox || config.sender_mailbox);
  await graphFetch(`/users/${mb}/messages/${messageId}`, {
    method: 'PATCH',
    body: JSON.stringify({ isRead: true }),
  });
}

/**
 * חיפוש הודעות משולח מסוים (למשל do-not-reply@) — למיפוי gatepass לפי מספר תיק.
 * מחזיר subject/body כדי לאתר את מספר התיק, וסימון האם יש צרופות.
 *
 * sinceDays: תוחם את החיפוש ל-receivedDateTime של N הימים האחרונים. הכרחי: Graph
 * פוסל שילוב $filter על from עם $orderby על receivedDateTime ("too complex"),
 * ולכן $top שטוח החזיר batch לא-ממוין מאמצע תיבה בת מאות הודעות ופספס את החדשות
 * (אומת בבדיקה חיה). טווח תאריכים + $filter על from כן נתמך. עם paging (nextLink)
 * עד maxTotal, כך שכל ההודעות בטווח מכוסות ולא רק עמוד ראשון.
 */
async function searchFrom(mailbox, fromAddress, { top = 100, sinceDays = null, maxTotal = 500 } = {}) {
  const mb = encodeURIComponent(mailbox || config.sender_mailbox);
  let filter = `from/emailAddress/address eq '${fromAddress}'`;
  if (sinceDays) {
    const since = new Date(Date.now() - sinceDays * 86400000).toISOString();
    filter += ` and receivedDateTime ge ${since}`;
  }
  let url = `/users/${mb}/mailFolders/inbox/messages?$filter=${encodeURIComponent(filter)}&$top=${top}` +
    `&$select=id,subject,from,receivedDateTime,bodyPreview,hasAttachments`;

  const msgs = [];
  while (url && msgs.length < maxTotal) {
    const data = await graphFetch(url);
    msgs.push(...(data?.value || []));
    const next = data?.['@odata.nextLink'];
    url = next ? next.replace(GRAPH, '') : null; // nextLink מוחזר אבסולוטי — חוזרים ליחסי
  }
  msgs.sort((a, b) => new Date(b.receivedDateTime || 0) - new Date(a.receivedDateTime || 0));
  return msgs;
}

/** צרופות של הודעה (מטא-דאטה: שם, contentType, contentBytes ל-fileAttachment) */
async function listAttachments(mailbox, messageId) {
  const mb = encodeURIComponent(mailbox || config.sender_mailbox);
  const data = await graphFetch(`/users/${mb}/messages/${messageId}/attachments`);
  return data?.value || [];
}

module.exports = { isEnabled, settings, getToken, sendMail, listUnread, markRead, searchFrom, listAttachments };
