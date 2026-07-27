// One-time (and "whenever the session expires") export step for the
// production/CI path. Run this locally, after `npm run login:thumbtack` has
// completed, to turn the saved browser profile into a portable Playwright
// storageState blob (cookies + localStorage, no password). Paste the output
// file's contents into the GitHub secret THUMBTACK_STORAGE_STATE — that's
// what scripts/thumbtack-agent-headless.mjs runs on in CI, since a GitHub
// Actions runner has no display and can't do the interactive login itself.
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { tryAcquireLock, releaseLock } from './lib/single-instance.mjs';

const profileDir = path.resolve('auth', 'thumbtack-profile');
const outPath = path.resolve(process.argv[2] ?? path.join('auth', 'session-state.json'));

if (!fs.existsSync(profileDir)) {
  console.error('No saved browser profile found at', profileDir);
  console.error('Run `npm run login:thumbtack` first to log in manually and save a session.');
  process.exit(1);
}

if (!tryAcquireLock()) {
  console.error('A Thumbtack browser window is currently open (from login or the agent). Close it first, then re-run this.');
  process.exit(1);
}

async function main() {
  try {
    const context = await chromium.launchPersistentContext(profileDir, { headless: true });
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto('https://www.thumbtack.com/pro-inbox', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);

      if (page.url().includes('/login')) {
        console.error('Session looks expired (redirected to login).');
        console.error('Run `npm run login:thumbtack` again first, then re-run this export.');
        process.exitCode = 1;
        return;
      }

      const state = await context.storageState();
      fs.writeFileSync(outPath, JSON.stringify(state));
      console.log('Session exported to', outPath);
      console.log('');
      console.log('Next steps:');
      console.log('  1. Copy the ENTIRE contents of that file into the GitHub secret THUMBTACK_STORAGE_STATE');
      console.log('     (repo Settings -> Secrets and variables -> Actions -> New repository secret).');
      console.log('  2. Delete the file afterwards — it contains live session cookies:', outPath);
    } finally {
      await context.close();
    }
  } finally {
    releaseLock();
  }
}

main();
