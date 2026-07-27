import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { bringPlaywrightWindowToFront } from './lib/foreground-window.mjs';
import { tryAcquireLock, releaseLock } from './lib/single-instance.mjs';
import { findUnansweredMessages, visitThread } from './lib/thumbtack-inbox.mjs';

const profileDir = path.resolve('auth', 'thumbtack-profile');

if (!fs.existsSync(profileDir)) {
  console.error('No saved browser profile found at', profileDir);
  console.error('Run `npm run login:thumbtack` first to log in manually and save a session.');
  process.exit(1);
}

const screenshotDir = path.resolve('screenshots');
fs.mkdirSync(screenshotDir, { recursive: true });
const logDir = path.resolve('logs');
fs.mkdirSync(logDir, { recursive: true });

async function main() {
  if (!tryAcquireLock()) {
    console.log('A Thumbtack browser window is already open — bringing it to the front instead of opening a new one.');
    bringPlaywrightWindowToFront();
    return;
  }

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: { width: 1280, height: 800 },
  });
  // Release the lock only once the window actually closes — the browser is
  // meant to stay open (and the profile stays locked to it) after the run.
  context.once('close', releaseLock);

  try {
    const page = context.pages()[0] ?? (await context.newPage());

    console.log('Opening Thumbtack Messages with the reused browser profile...');
    await page.goto('https://www.thumbtack.com/pro-inbox', { waitUntil: 'domcontentloaded' });
    bringPlaywrightWindowToFront();
    await page.waitForTimeout(1500);

    const currentUrl = page.url();
    if (currentUrl.includes('/login')) {
      console.log('SESSION EXPIRED — redirected back to login.');
      console.log('Re-run `npm run login:thumbtack` to refresh the session.');
      process.exitCode = 1;
    } else {
      console.log('Session valid. Checking for unanswered messages...');
      const unanswered = await findUnansweredMessages(page);

      if (unanswered.length === 0) {
        console.log('No unanswered messages right now.');
      } else {
        console.log(`Found ${unanswered.length} unanswered message(s). Opening each one in its own tab...`);
        // Thumbtack doesn't persist an unsent draft across navigation, so each
        // thread gets its own tab rather than reusing one — otherwise moving
        // on to the next conversation would wipe out the previous draft.
        for (const [i, m] of unanswered.entries()) {
          console.log(`\n[${i + 1}/${unanswered.length}] Opening thread with ${m.customer}...`);
          const threadPage = await context.newPage();
          const { threadText, sent } = await visitThread(threadPage, m.url);
          m.threadText = threadText;
          m.replySent = sent;
          console.log(threadText);
          console.log(sent ? '  Reply sent.' : '  Reply NOT sent (see warning above).');
        }
      }

      const resultsPath = path.join(logDir, 'unanswered-messages.json');
      fs.writeFileSync(resultsPath, JSON.stringify({ checkedAt: new Date().toISOString(), unanswered }, null, 2));
      console.log('\nResults saved to', resultsPath);

      const screenshotPath = path.join(screenshotDir, 'agent-dashboard.png');
      try {
        await page.screenshot({ path: screenshotPath, timeout: 10000 });
        console.log('Screenshot saved to:', screenshotPath);
      } catch (err) {
        console.log('Screenshot failed (non-fatal):', err.message);
      }
    }

    console.log('');
    console.log('Leaving the browser window open. Close it yourself whenever you\'re done.');
  } catch (err) {
    console.error('Agent run failed:', err);
    process.exitCode = 1;
    await context.close().catch(() => {});
  }
}

main();
