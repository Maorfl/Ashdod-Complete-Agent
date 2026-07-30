# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Caspi Agent (סוכן כספי)** — an internal automation system for a customs brokerage/freight forwarder (ה.כספי) that manages release of cargo at Ashdod port and its transfer to Haifa. Runs on an internal server, accessed by multiple machines on the local network via browser. All domain content is in Hebrew; technical identifiers are in English. The UI is RTL.

Core principles (do not violate these when making changes):
- **Zero LLM dependency at runtime** — routing logic is a deterministic decision tree (`server/src/report/classifier.js`). No AI calls in the pipeline.
- **Human-in-the-loop** — no external email is ever sent without explicit human approval on the Approvals page, except the narrow per-department auto-send path described below (off by default for two of three departments, and gated by a hard age cutoff on top of that).
- **External recipient override (safety net)** — every external recipient (importers/carriers/terminals) in an email's `To` is routed to `config.external_email_override` (currently `maorfl14@gmail.com`) instead of the real address. Internal system emails (sender + CC) are left untouched. Never bypass or remove this override.

## Commands

Run from repo root (npm workspaces: `server`, `client`):

```bash
npm install              # installs deps for both workspaces
npm run dev               # concurrently: server (--watch) + vite dev server (client proxies /api)
npm run build             # builds client only (tsc -b && vite build -> client/dist)
npm start                 # runs server only (serves API + client/dist), listens on 0.0.0.0:4000
npm run test:pipeline     # -> server: node src/test-pipeline.js
```

Server-only scripts (run inside `server/`):
```bash
npm run test:pipeline     # runs reader -> classifier -> composer over data/אשדוד.xlsx, prints routing stats, asserts every external recipient is override-routed. Sends nothing.
npm run recompose         # node src/recompose-drafts.js
npm run reset-shipments   # node src/reset-shipments.js
npm run build-importers   # -> scripts/build-importers-from-xlsx.js
```

Other scripts (`scripts/`, run with `node scripts/<file>.js`):
- `build-importers-from-xlsx.js [report-path]` — generates `data/importers/<name>/importer.json` and `data/departments/cus{1,2,3}.json` from the Focus report. Defaults to `config.report_path`.
- `cleanup-out-of-scope-cus1.js`, `fix-existing-draft-recipients.js`, `generate-instructions.js`, `import-carriers-terminals.js`, `import-haifa-transfer-customers.js` — one-off data migration/import utilities.

There is no test framework beyond `test:pipeline` (a manual integration script, not unit tests) — there is no `npm test` / jest / vitest setup.

**IMPORTANT — never trigger a real send while testing.** Microsoft Graph credentials in `server/.env` are live in dev; calling approve/sendMail paths against a running dev server actually sends mail. Use `test:pipeline` (dry) for pipeline verification, and never call the approval-decision endpoint with real data during manual testing.

**Server process ownership** — the user runs `npm start` themselves. Don't hold port 4000 yourself; after editing server code, ask the user to restart rather than starting the server in the background.

## Architecture

| Layer | Technology |
|---|---|
| Frontend | React + TypeScript + Vite (RTL) |
| Backend | Node.js + Express (plain JS, no TS) |
| Shipment tracking | SQLite via `better-sqlite3` (WAL mode) |
| Importers + departments | local JSON files under `data/` |
| Excel/CSV report reading | `xlsx` (SheetJS) |
| OCR (edge cases) | `tesseract.js` (heb+eng) |
| Outbound mail | Microsoft Graph (client-credentials/app-only) |
| Structure | npm workspaces (`server`, `client`) |

### The two-clock pipeline (`server/src/services/reportWatcher.js`)

This is the heart of the system and the least discoverable part of the architecture — read this before touching ingestion/scheduling:

1. **Scan clock** (`scanOnce`, every `config.poll_interval_minutes`, default 10 min) — reads and parses the source report (CSV/XLSX at `config.report_path`, overridable via `REPORT_PATH` env var) into an **in-memory cache only**. Never touches the DB. Keeps the dashboard fresh without hammering storage.
2. **Commit clock** (`commit`, wall-clock aligned to `commit_before_hour_minutes` before each hour, e.g. `HH:55`) — takes the latest scan cache and actually runs the pipeline: scope filter → classify → upsert to SQLite → build draft / (optionally) auto-send. This is the *only* window that writes to the DB or sends mail. Rescheduled fresh from `now` each cycle so it survives restarts/DST drift.

`runNow()` / `runOnce()` bypasses both clocks for manual/test runs (migrate → scan → commit immediately).

Records that are `no_op` (wrong customs station) are never persisted — only counted. `alert` records are persisted for manual review but never get a draft/email.

### The classifier decision tree (`server/src/report/classifier.js`)

Deterministic, **first match wins**, zero LLM:
1. **no_op** — `Customs Station Code` ≠ 2 (not Ashdod).
2. **prepaid** — `Inter. Forwarder` is not Caspi → importer handles release directly. Never emails a draft.
3. **co_loader** — `Co Loader Code` present → routes to the consolidating carrier (`contacts`/`co_loaders.json`).
4. **terminal** — no co-loader code → routes by `Cust. Stor. Site Des` (`terminals.json`).
5. **direct** — importer type is `direct` → direct release.
6. **alert** — unrecognized code/terminal → manual review, nothing sent.

Notable embedded rules:
- **Hazardous cargo override**: when marked hazardous and the resolved continuation carrier is the default (`hazardous_default_carrier`, "גולד בונד"), it's automatically swapped to `hazardous_override_carrier` ("סמא") — Gold Bond doesn't handle hazardous goods.
- **`isHaifaTransfer`** — a shipment only qualifies for a Haifa-transfer draft when *all* of: released at Ashdod (station 2), `FCL/LCL` = LCL, has a release terminal that isn't the port itself (`נמל אשדוד`/`נמל הדרום`), and route is one of `co_loader`/`terminal`/`direct`. FCL and prepaid shipments are tracked/counted in the dashboard but never drafted.
- **Gatepass PDF gating** — Haifa-transfer routes (`requiresGatepass`) are blocked from sending until a gatepass PDF is attached (fetched via `gatepassFetcher.js` from Graph inbox, or attached manually). Shipments sit in `awaiting_gatepass`/`AWAITING_PDF` status until then — the draft is built once, held, and retried, never rebuilt late.
- **`realTo` / recipient assembly** — real external recipients are merged (co-loader/terminal + transfer performer looked up by name + importer + continuation carrier — but only if the importer actually has a continuation carrier configured), deduped, and only fall back to the safety override if no real address is found. This still passes through `external_email_override` for the actual send.
- `contacts.js` (`server/src/db/`) is the single source of truth for co-loader/terminal lookups and name-based email resolution — don't duplicate that lookup logic elsewhere.

### Haifa-transfer automation (`server/src/services/automation.js`)

Optional per-department auto-send for Haifa-transfer drafts (`co_loader`/`terminal` routes only), layered on top of the normal human-approval flow — the Approvals page and manual send are always available regardless of this system's state.

- **State**: `data/automation.json` (read/written live at runtime, *not* `config/config.json` — no server restart needed to take effect). Shape: `{ killSwitch, departments: { cus1, cus2, cus3 }, epoch }`, each department one of `off` / `dry_run` / `on`. Shipped default: `cus1: on`, `cus2: off`, `cus3: off`.
  - `off` — no automation for that department.
  - `dry_run` — the full gate + draft-building runs, but `graph.sendMail()` is never called and the shipment is never marked sent; it stays on the normal `AWAITING_PDF`→`pending_approval` path. The simulated send (resolved recipients, subject, body, whether a PDF would attach) is logged to the `dry_run_log` SQLite table (`db/shipments.js`) for review.
  - `on` — sends for real, same as the old single global flag used to.
  - A global `killSwitch` forces every department to behave as `off` regardless of their individual setting (`automation.effectiveDeptMode(dept)` applies this).
- **Hard age cutoff — the most important safety property here.** Automation must never touch the backlog of shipments that existed before this system went live. Enforced two independent ways, both required:
  1. `shipments.auto_send_excluded` (SQLite column) — stamped `1` once, permanently, on every shipment row that existed at the moment `data/automation.json` was first created (`automation.ensureInitialized()`, called from `index.js` at boot). New rows default to `NULL` (=not excluded) and are never touched by this migration again — it only ever updates rows still `NULL`, so it's safe to call on every boot.
  2. `epoch` in `data/automation.json`, set once at that same first-boot moment — a shipment is only eligible if its `first_seen` is after the epoch.
  Both checks live in `automation.isEligibleByCutoff(rec)`. Any ambiguity (missing column, missing epoch, unparseable date) is treated as **ineligible** — the gate only ever fails closed, never open.
  - `reset-shipments.js` (which wipes and reseeds the whole `shipments` table) re-runs the exclusion stamp immediately after reseeding, since a fresh `first_seen` would otherwise make the entire reseeded backlog look "new" to the epoch check.
- **The gate**: `reportWatcher.autoSendEnabled(route, dept, shipmentRec)` — checks department mode ≠ `off`, route is `co_loader`/`terminal`, Graph is connected, and `automation.isEligibleByCutoff(shipmentRec)`. Called from `commit()` only *after* the shipment's own `upsert()` (so `first_seen` actually exists to check against).
- **UI**: `client/src/pages/Automation.tsx` (`/automation`, nav group "תפעול") — per-department off/dry_run/on controls (switching to `on` requires an explicit `ConfirmModal` naming the consequence; `off`/`dry_run` don't), the kill switch, the epoch date, and a "נדרש לטיפול" list of held/flagged shipments (reasons via `status.ts`'s `needsAttentionReason`/`isStaleHold`), filtered by the existing global `AgentFilterContext`. `FileModal` shows a quiet "מחוץ לאוטומציה" badge when `auto_send_excluded` is set.
- **API**: `GET /api/automation`, `PUT /api/automation/department/:dept` (`{ mode }`), `PUT /api/automation/kill-switch` (`{ on }`) — `server/src/routes/automation.js`.
- The old global `config.feature_flags.auto_send_haifa_transfer` boolean/string flag is legacy and no longer read by the gate (there's a dead in-memory migration for it in `config.js`, kept only so old `config.json` files don't error) — the per-department `data/automation.json` state is the only thing that matters now.

### Scope filtering (`server/src/scope.js`, `config.report_scope`)

A separate, simpler gate applied before classification: which report rows even enter the pipeline (currently just LCL freight-mode + an optional service-rep filter + customer whitelist, though whitelist/rep restrictions have been relaxed per user decisions logged in `config/config.json` comments). Ashdod-only enforcement (station code 2) happens in the classifier's `no_op` rule, not here.

### Status lifecycle (shipments, `server/src/db/shipments.js`)

Key statuses referenced across the codebase: `alert`, `pending_approval`, `awaiting_gatepass`, `AWAITING_PDF` (constant, "ממתין ל-PDF"), `שוחרר באשדוד`, `יצא לחיפה`, `התקבל בחיפה`, `נמסר ללקוח`, plus the logical `sent`. `config.tracking.owns_file_statuses` defines which statuses mean "already handled" (prevents duplicate sends). Retention (`services/retention.js`) purges `נמסר ללקוח` records after `retention.delivered_days` and gatepass PDFs after `retention.gatepass_pdf_days`.

### Server layout (`server/src/`)

- `index.js` — Express app entry; wires routes, starts `reportWatcher`, `retention`, and (if Graph enabled) `mailTracker`, `gatepassFetcher`, `dailyReport`. Serves `client/dist` as static + SPA fallback.
- `config.js` — loads `config/config.json` + `config/co_loaders.json` + `config/terminals.json`; exposes `ROOT`, `PORT`, `HOST`, `config`, `continuationCarriers`, `dangerousGoods`.
- `report/` — `reader.js` (parses the source report into normalized records), `classifier.js` (decision tree, see above).
- `email/` — `composer.js` (builds release-notice draft bodies), `grammar.js` (Hebrew gender/number agreement helpers for composed text — carriers/contacts have `gender`/`number` fields precisely for this).
- `db/` — `shipments.js` (SQLite/WAL shipment tracking + history + sent-email log + `dry_run_log` + `auto_send_excluded`/`migrateAutoSendExclusion`), `importers.js`, `departments.js`, `contacts.js` (co-loaders/terminals lookup).
- `services/` — `reportWatcher.js` (two-clock pipeline, see above), `automation.js` (per-department auto-send state + hard age cutoff, see "Haifa-transfer automation" above), `graphMail.js` (MS Graph client-credentials send/read), `mailTracker.js` (polls inbox for delivery/arrival signals), `gatepassFetcher.js` (finds gatepass PDFs by file number in Graph inbox), `dailyReport.js` (twice-daily per-department digest email, now with an automation stats block), `retention.js` (scheduled cleanup), `ocr.js` (tesseract.js fallback for edge cases).
- `routes/` — one file per REST resource: `shipments`, `approvals`, `importers`, `contacts` (serves both `/api/terminals` and `/api/co-loaders`), `sentEmails`, `version`, `automation` (per-department mode + kill switch).
- `version.js` — checks current version against GitHub releases (`config.github`).

### Client layout (`client/src/`)

Pages (`pages/`): `Dashboard` (5 status counters + case list), `Approvals` (approve/edit/reject drafts before send), `Automation` (per-department auto-send controls + "נדרש לטיפול" list), `Importers` (importer CRUD), `TerminalsForwarders`, `SentEmails`. `api.ts` is the single fetch wrapper for the backend; `context/AgentFilterContext.tsx` holds cross-page filter state; `components/` holds shared modals (`FileModal`, `ConfirmModal`, `ShipmentNotesModal`, `EmailListEditor`, `Toasts`, `PasswordGate`).

### Data & config

- `config/config.json` — the master config: report path, poll/commit intervals, scope rules, forwarder/carrier names, Graph settings, retention policy, feature flags, department emails. Read the inline `_comment`/`*_comment` fields before changing values — they document *why*, including dated user decisions.
- `config/co_loaders.json`, `config/terminals.json` — routing targets consumed via `db/contacts.js`.
- `data/importers/<name>/importer.json` — one file per importer (CRUD'd through the Importers page and `routes/importers.js`).
- `data/departments/cus{1,2,3}.json` — department metadata.
- `data/shipments.db` — SQLite (WAL), auto-created if missing.
- `data/automation.json` — per-department Haifa-transfer auto-send state (see "Haifa-transfer automation" above); read/written live, no restart needed. Auto-created on first boot.
- Env overrides: `server/.env` (copy from `server/.env.example`) — e.g. `REPORT_PATH` to override `config.report_path` for local/dev use, `GRAPH_CLIENT_SECRET`.

### Feature flags (`config.feature_flags`)

- `ashdod_release` — master switch for the whole commit pipeline.
- `haifa_arrival` — arrival tracking.
- `daily_report` — twice-daily (09:00/15:00) per-department digest of shipments "יצא לחיפה" for 2+ days, now including an automation summary block (auto-sent/held/stale counts per department, styled consistently with the rest of that email); internal-only, does not go through the classifier or the external override.

Haifa-transfer auto-send is no longer a single feature flag — see "Haifa-transfer automation" above (`data/automation.json`, per-department, with a hard age cutoff).

## Known open gaps (see README.md "פערים פתוחים")

- Real contact details still missing for some co-loader codes (`635/674/15373`) and terminals (`bonded`/`swissport`) — currently `needs_review: true` + override.
- Some importers still have `type: unknown` (needs mapping via the Importers page).
- Unmapped sites (e.g. `נמל אשדוד` variants) fall through to `alert` until added to `terminals.json`.
- Empty `Inter. Forwarder` is treated as Caspi via `config.empty_forwarder_is_caspi` — a reversible assumption, not a hard rule.
