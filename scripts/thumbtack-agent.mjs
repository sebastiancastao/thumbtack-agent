import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { bringPlaywrightWindowToFront } from './lib/foreground-window.mjs';
import { tryAcquireLock, releaseLock } from './lib/single-instance.mjs';

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

const REPLY_MESSAGE =
  "Thank you for reaching out! Our team is available Monday-Sunday from 8 AM to 8 PM, and we'll get back to you as soon as possible during those hours.";

// Tries several selector strategies since Thumbtack doesn't expose one
// stable hook for the composer's send button.
async function clickSend(page) {
  const candidates = [
    page.getByRole('button', { name: 'Send', exact: true }),
    page.getByRole('button', { name: /^send$/i }),
    page.locator('button[aria-label="Send" i]'),
  ];
  for (const candidate of candidates) {
    const btn = candidate.first();
    if (await btn.isVisible().catch(() => false)) {
      const disabled = await btn.isDisabled().catch(() => true);
      if (!disabled) {
        await btn.click();
        return true;
      }
    }
  }
  return false;
}

async function findUnansweredMessages(page) {
  // Thumbtack's own "Unread" folder is the most reliable current signal for
  // "needs a reply" — it's what drives the Messages tab's unread badge.
  await page.goto('https://www.thumbtack.com/pro-inbox/unread', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  const rows = page.locator('a.db[href^="/pro-inbox/messages/"]');
  const count = await rows.count();

  const results = [];
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const href = await row.getAttribute('href');
    const name = await row.locator('.b').first().innerText().catch(() => '(unknown)');
    const date = await row.locator('span.tp-body-3').first().innerText().catch(() => '');
    const jobInfo = await row.locator('p.mt1').first().innerText().catch(() => '');
    const fullText = await row.innerText().catch(() => '');
    const snippet = fullText
      .replace(name, '')
      .replace(date, '')
      .replace(jobInfo, '')
      .trim();
    results.push({
      customer: name.trim(),
      date: date.trim(),
      jobInfo: jobInfo.trim(),
      snippet,
      url: `https://www.thumbtack.com${href}`,
    });
  }
  return results;
}

async function visitThread(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // First-time "see if they read your reply" tooltip blocks the thread.
  const gotIt = page.getByText('Got it', { exact: true });
  if (await gotIt.isVisible().catch(() => false)) {
    await gotIt.click().catch(() => {});
    await page.waitForTimeout(300);
  }

  const bodyText = await page.locator('body').innerText();
  // The left nav/sidebar is static boilerplate that ends with this line;
  // everything after it is the actual thread + job-details panel.
  const marker = 'to automatically send new leads and messages into your system.';
  const idx = bodyText.indexOf(marker);
  const threadText = idx === -1 ? bodyText : bodyText.slice(idx + marker.length).trim();

  let sent = false;
  try {
    const box = page.getByPlaceholder('Type message');
    await box.waitFor({ state: 'visible', timeout: 8000 });
    await box.click();
    await box.type(REPLY_MESSAGE, { delay: 15 });
    const typedValue = await box.inputValue().catch(() => '');
    const typed = typedValue === REPLY_MESSAGE;

    if (typed) {
      const clicked = await clickSend(page);
      if (clicked) {
        // The composer clears once the message actually goes through.
        await page.waitForTimeout(1500);
        const afterValue = await box.inputValue().catch(() => '');
        sent = afterValue === '';
        if (!sent) {
          console.log('  Send was clicked but the composer still has text — send may have failed.');
        }
      } else {
        console.log('  Could not find an enabled Send button in this thread.');
      }
    } else {
      console.log('  Could not type the reply into this thread.');
    }
  } catch (err) {
    console.log('  Could not send a reply in this thread:', err.message);
  }

  return { threadText, sent };
}

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
