import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { config } from 'dotenv';
import { bringPlaywrightWindowToFront } from './lib/foreground-window.mjs';
import { tryAcquireLock, releaseLock } from './lib/single-instance.mjs';

config({ path: path.resolve('.env.local') });

const EMAIL = process.env.THUMBTACK_EMAIL;
const PASSWORD = process.env.THUMBTACK_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error('Missing THUMBTACK_EMAIL / THUMBTACK_PASSWORD in .env.local');
  process.exit(1);
}

// Fixed, reused profile directory (not a fresh temp dir per run). Reusing the
// same browser identity/cookies across runs is what keeps Thumbtack from
// treating every run as a brand-new unrecognized device and re-prompting for
// human verification every single time.
const profileDir = path.resolve('auth', 'thumbtack-profile');
fs.mkdirSync(profileDir, { recursive: true });

async function main() {
  if (!tryAcquireLock()) {
    console.log('A Thumbtack browser window is already open — bringing it to the front instead of opening a new one.');
    bringPlaywrightWindowToFront();
    return;
  }

  try {
    const context = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      viewport: { width: 1280, height: 800 },
    });
    const page = context.pages()[0] ?? (await context.newPage());

    console.log('Opening Thumbtack login page...');
    await page.goto('https://www.thumbtack.com/login', { waitUntil: 'domcontentloaded' });
    bringPlaywrightWindowToFront();
    await page.waitForTimeout(500);
    bringPlaywrightWindowToFront();

    // Thumbtack's login form uses these specific fields (confirmed by inspecting
    // the live DOM) rather than generic type/name selectors.
    const emailInput = page
      .locator('#login-page-email, input[name="login_email"], input[type="email"]')
      .first();
    const passwordInput = page
      .locator('#login-page-password, input[name="login_password"], input[type="password"]')
      .first();

    // Only re-fill a field that is genuinely empty — never overwrite something
    // the human is actively typing.
    async function fillIfEmpty() {
      const emailValue = await emailInput.inputValue().catch(() => null);
      if (emailValue === '') await emailInput.fill(EMAIL).catch(() => {});
      const passwordValue = await passwordInput.inputValue().catch(() => null);
      if (passwordValue === '') await passwordInput.fill(PASSWORD).catch(() => {});
    }

    const alreadyLoggedIn = !page.url().includes('/login') && !page.url().includes('/user/login');
    if (alreadyLoggedIn) {
      console.log('Already logged in from a previous session. Nothing to do.');
    } else {
      try {
        await emailInput.waitFor({ state: 'visible', timeout: 15000 });
        await passwordInput.waitFor({ state: 'visible', timeout: 15000 });
        await emailInput.fill(EMAIL);
        await passwordInput.fill(PASSWORD);
        console.log('Credentials filled in.');
      } catch (err) {
        console.log('Could not find the login fields to auto-fill; fill it in manually.', err.message);
      }

      console.log('');
      console.log('>>> Please complete the login yourself in the browser window');
      console.log('    (password, any human verification, 2FA, etc.).');
      console.log('    This script will detect success automatically once you are');
      console.log('    redirected away from the login page.');
      console.log('');

      // Some anti-bot sensors wipe the form a few seconds after the initial fill
      // (specifically to defeat scripted logins). Keep healing empty fields for
      // as long as we're on the login page, without ever touching a field the
      // human is actively filling in themselves.
      const deadline = Date.now() + 10 * 60 * 1000; // 10 minutes to complete manual login
      let loggedIn = false;
      while (Date.now() < deadline) {
        const url = page.url();
        if (!url.includes('/login') && !url.includes('/user/login')) {
          loggedIn = true;
          break;
        }
        await fillIfEmpty();
        await page.waitForTimeout(1000);
      }

      if (!loggedIn) {
        console.error('Timed out waiting for manual login to complete.');
        process.exitCode = 1;
        await context.close();
        return;
      }

      console.log('Login detected. Session saved in the reused browser profile at:', profileDir);
    }

    await context.close();
  } finally {
    releaseLock();
  }
}

main();
