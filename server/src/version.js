/**
 * version.js — בדיקת גרסה מול GitHub Releases.
 * משווה current_version מול ה-release האחרון. אם מאחור — update_required.
 * משתמש ב-fetch מובנה (אין צורך ב-LLM). אם github.owner לא הוגדר — מחזיר not_configured.
 */
const { config } = require('./config');

function cmp(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

async function checkVersion() {
  const { owner, repo, current_version } = config.github;
  const result = { current: current_version, latest: current_version, update_required: false, source: 'github' };
  if (!owner || owner.startsWith('REPLACE')) {
    result.source = 'not_configured';
    return result;
  }
  try {
    const headers = { 'User-Agent': 'caspi-agent', Accept: 'application/vnd.github+json' };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, { headers });
    if (!res.ok) {
      result.error = `github ${res.status}`;
      return result;
    }
    const data = await res.json();
    const latest = data.tag_name || data.name || current_version;
    result.latest = latest;
    result.update_required = cmp(latest, current_version) > 0;
    result.release_url = data.html_url;
  } catch (e) {
    result.error = String(e.message || e);
  }
  return result;
}

module.exports = { checkVersion, cmp };
