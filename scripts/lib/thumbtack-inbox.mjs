// Shared "check unread messages and reply" logic used by both the local,
// headful agent (scripts/thumbtack-agent.mjs) and the headless, CI-friendly
// agent (scripts/thumbtack-agent-headless.mjs). Keeping this in one place
// means the two entrypoints can never drift apart on selector logic.

export const REPLY_MESSAGE =
  "Thank you for reaching out! Our team is available Monday-Sunday from 8 AM to 8 PM, and we'll get back to you as soon as possible during those hours.";

// Tries several selector strategies since Thumbtack doesn't expose one
// stable hook for the composer's send button.
export async function clickSend(page) {
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

export async function findUnansweredMessages(page) {
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

// dryRun: check everything (thread text, whether a composer is present and
// enabled) without ever typing into it or clicking Send — for testing
// against real, live leads without actually messaging them.
export async function visitThread(page, url, { dryRun = false } = {}) {
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

    if (dryRun) {
      const composerVisible = await box.isVisible().catch(() => false);
      console.log(composerVisible
        ? '  [DRY RUN] Composer found — a real run would reply here.'
        : '  [DRY RUN] No composer found — a real run would NOT be able to reply here.');
      return { threadText, sent: false };
    }

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
