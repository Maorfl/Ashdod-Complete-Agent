/**
 * recompose-gatepass-coloader.js — מריץ את חילוץ/יישוב קוד הקו-לואדר מה-PDF (Task 1/2,
 * תוספת gatepass) על תיקי co_loader/terminal שכבר יש להם gatepass_pdf_path אך טרם
 * נותחו (gatepass_co_loader_rule ריק) — או שנותחו לפני שינוי לוגי (--force).
 *
 * לכל תיק: מריץ services/gatepassParser.parseGatepassPdf, מיישב מול
 * report/gatepassCoLoaderDecision.resolveCoLoader, ואם התוצאה משנה את קוד הקו-לואדר
 * האפקטיבי (כלל match/adopt) — מחדש את draft_payload.email דרך composer.composeRelease
 * עם rec.co_loader_code המתוקן, בדיוק כמו recompose-drafts.js הקיים. תיקי mismatch/
 * extraction_failed מסומנים ל-hold (לא נבנית/מתעדכנת טיוטת העברה) — ראו setStatus.
 *
 * בטוח: אינו שולח מייל. אפס תלות ב-LLM.
 * שימוש: node src/recompose-gatepass-coloader.js [--force]
 */
const { readReport } = require('./report/reader');
const { classify } = require('./report/classifier');
const { composeRelease } = require('./email/composer');
const { resolveCoLoader } = require('./report/gatepassCoLoaderDecision');
const { parseGatepassPdf } = require('./services/gatepassParser');
const imp = require('./db/importers');
const shipments = require('./db/shipments');
const { REPORT_PATH } = require('./config');

const TRANSFER_ROUTES = new Set(['co_loader', 'terminal']);
const FORCE = process.argv.includes('--force');

async function main() {
  const { records } = readReport(REPORT_PATH);
  const byFile = new Map(records.map((r) => [String(r.file_number), r]));

  const candidates = shipments.all().filter((s) =>
    TRANSFER_ROUTES.has(s.route) &&
    s.gatepass_pdf_path &&
    (FORCE || !s.gatepass_co_loader_rule)
  );

  const summary = { candidates: candidates.length, match: 0, adopt: 0, terminal: 0, mismatch_hold: 0, extraction_failed: 0, not_in_report: 0, errors: 0 };

  for (const ship of candidates) {
    try {
      const rec = byFile.get(String(ship.file_number));
      if (!rec) { summary.not_in_report += 1; continue; }

      const parseResult = await parseGatepassPdf(ship.gatepass_pdf_path, ship.file_number);
      const decision = resolveCoLoader(rec.co_loader_code, parseResult);
      summary[decision.rule] = (summary[decision.rule] || 0) + 1;

      shipments.setGatepassParseResult(ship.file_number, {
        dealId: decision.dealId, coLoaderCode: parseResult.coLoaderCode || null, rule: decision.rule,
      });

      if (decision.hold) {
        console.log(`  [hold] ${ship.file_number} — ${decision.reason}`);
        continue;
      }

      // match/adopt/terminal — מיישבים rec.co_loader_code לפי ההחלטה ומחדשים את הטיוטה
      const effectiveRec = { ...rec, co_loader_code: decision.resolvedCoLoaderCode || '' };
      const importer = imp.findByName(effectiveRec.customer_name);
      const newDecision = classify(effectiveRec, importer);
      if (newDecision.route !== 'co_loader' && newDecision.route !== 'terminal') continue; // לא אמור לקרות

      const email = composeRelease(effectiveRec, newDecision, importer);
      let payload = {};
      try { payload = ship.draft_payload ? JSON.parse(ship.draft_payload) : {}; } catch { payload = {}; }
      payload.email = email;
      payload.route = newDecision.route;
      payload.needs_review = !!newDecision.needs_review;

      shipments.upsert({
        file_number: ship.file_number,
        route: newDecision.route,
        co_loader_code: decision.resolvedCoLoaderCode || null,
        draft_payload: payload,
      });
      console.log(`  [${decision.rule}] ${ship.file_number} — קוד סופי: ${decision.resolvedCoLoaderCode || '(מסוף)'}`);
    } catch (e) {
      summary.errors += 1;
      console.error('  שגיאה בתיק', ship.file_number, '—', e.message);
    }
  }

  console.log('=== יישוב קוד קו-לואדר מ-gatepass PDF ===');
  console.log(JSON.stringify(summary, null, 2));
}

main();
