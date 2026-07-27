import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { config } from 'dotenv';

config({ path: path.resolve('.env.local') });

const EMAIL = process.env.THUMBTACK_EMAIL;
const PASSWORD = process.env.THUMBTACK_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error('Missing THUMBTACK_EMAIL / THUMBTACK_PASSWORD in .env.local');
  process.exit(1);
}

const screenshotDir = path.resolve('screenshots');
fs.mkdirSync(screenshotDir, { recursive: true });

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  try {
    console.log('Navigating to Thumbtack login page...');
    await page.goto('https://www.thumbtack.com/login', { waitUntil: 'domcontentloaded' });

    const emailInput = page.locator('input[type="email"], input[name="email"]').first();
    await emailInput.waitFor({ state: 'visible', timeout: 20000 });
    await emailInput.fill(EMAIL);

    // Some login flows are two-step: submit email first, then a password field appears.
    const passwordInput = page.locator('input[type="password"], input[name="password"]').first();
    if (!(await passwordInput.isVisible().catch(() => false))) {
      const continueButton = page
        .locator('button[type="submit"], button:has-text("Continue"), button:has-text("Next")')
        .first();
      if (await continueButton.isVisible().catch(() => false)) {
        await continueButton.click();
      }
      await passwordInput.waitFor({ state: 'visible', timeout: 20000 });
    }
    await passwordInput.fill(PASSWORD);

    const submitButton = page
      .locator('button[type="submit"], button:has-text("Log in"), button:has-text("Sign in")')
      .first();
    await submitButton.click();

    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(3000);

    const screenshotPath = path.join(screenshotDir, 'post-login.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const currentUrl = page.url();
    const errorLocator = page.locator(
      'text=/incorrect|invalid|couldn\'t find|wrong password|try again/i'
    );
    const hasError = await errorLocator.first().isVisible().catch(() => false);
    const stillOnLoginPage = currentUrl.includes('/login');

    if (hasError || stillOnLoginPage) {
      console.log('LOGIN FAILED');
      console.log('Current URL:', currentUrl);
      console.log('Screenshot saved to:', screenshotPath);
      process.exitCode = 1;
    } else {
      console.log('LOGIN SUCCEEDED');
      console.log('Current URL:', currentUrl);
      console.log('Screenshot saved to:', screenshotPath);
    }
  } catch (err) {
    console.error('Script error:', err.message);
    const screenshotPath = path.join(screenshotDir, 'error.png');
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    console.log('Screenshot saved to:', screenshotPath);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
