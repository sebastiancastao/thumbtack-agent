// Production entrypoint: runs headless (no window, no local profile) using a
// saved Playwright storageState instead of a persistent browser profile.
// This is what the GitHub Actions cron workflow (.github/workflows/
// thumbtack-agent.yml) runs. It intentionally cannot do the interactive
// login itself — there's no display and no human to solve Thumbtack's
// verification challenge in CI. Generate the session locally first with
// `npm run login:thumbtack` then `npm run export:thumbtack-session`, and
// store the result in the THUMBTACK_STORAGE_STATE secret.
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { findUnansweredMessages, visitThread } from './lib/thumbtack-inbox.mjs';

const rawState = process.env.THUMBTACK_STORAGE_STATE;
if (!rawState) {
  console.error('Missing THUMBTACK_STORAGE_STATE env var.');
  console.error('Run `npm run login:thumbtack` then `npm run export:thumbtack-session` locally,');
  console.error('and put the exported file\'s contents in that secret/env var.');
  process.exit(1);
}

let storageState;
try {
  storageState = JSON.parse(rawState);
} catch (err) {
  console.error('THUMBTACK_STORAGE_STATE is not valid JSON:', err.message);
  process.exit(1);
}

const logDir = path.resolve('logs');
fs.mkdirSync(logDir, { recursive: true });

const dryRun = process.env.DRY_RUN === 'true';
if (dryRun) {
  console.log('DRY RUN — will report unanswered messages but will NOT actually reply to anyone.\n');
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState });

  try {
    const page = await context.newPage();

    console.log('Opening Thumbtack Messages with the saved session...');
    await page.goto('https://www.thumbtack.com/pro-inbox', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    if (page.url().includes('/login')) {
      console.error('SESSION EXPIRED — redirected back to login.');
      console.error('Re-run `npm run login:thumbtack` + `npm run export:thumbtack-session` locally');
      console.error('and update the THUMBTACK_STORAGE_STATE secret.');
      process.exitCode = 1;
      return;
    }

    console.log('Session valid. Checking for unanswered messages...');
    const unanswered = await findUnansweredMessages(page);

    if (unanswered.length === 0) {
      console.log('No unanswered messages right now.');
    } else {
      console.log(`Found ${unanswered.length} unanswered message(s). Replying to each...`);
      for (const [i, m] of unanswered.entries()) {
        console.log(`\n[${i + 1}/${unanswered.length}] Opening thread with ${m.customer}...`);
        const threadPage = await context.newPage();
        const { threadText, sent } = await visitThread(threadPage, m.url, { dryRun });
        m.threadText = threadText;
        m.replySent = sent;
        if (!dryRun) {
          console.log(sent ? '  Reply sent.' : '  Reply NOT sent (see warning above).');
        }
        await threadPage.close();
      }
    }

    const resultsPath = path.join(logDir, 'unanswered-messages.json');
    fs.writeFileSync(resultsPath, JSON.stringify({ checkedAt: new Date().toISOString(), unanswered }, null, 2));
    console.log('\nResults saved to', resultsPath);
  } catch (err) {
    console.error('Agent run failed:', err);
    process.exitCode = 1;
  } finally {
    await context.close();
    await browser.close();
  }
}

main();
