import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

const inputPath = path.resolve(process.argv[2] ?? path.join('auth', 'exported-cookies.json'));
const profileDir = path.resolve('auth', 'thumbtack-profile');

if (!fs.existsSync(inputPath)) {
  console.error(`No cookie export found at ${inputPath}`);
  console.error('Export cookies for thumbtack.com from your regular browser first (see README instructions).');
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));

const SAME_SITE_MAP = {
  no_restriction: 'None',
  unspecified: 'Lax',
  lax: 'Lax',
  strict: 'Strict',
  none: 'None',
};

function toPlaywrightCookie(c) {
  const sameSite = SAME_SITE_MAP[(c.sameSite ?? '').toLowerCase()] ?? c.sameSite ?? 'Lax';
  const expires = c.session ? -1 : Math.round(c.expirationDate ?? c.expires ?? -1);
  return {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path ?? '/',
    expires,
    httpOnly: !!c.httpOnly,
    secure: !!c.secure,
    sameSite: ['Strict', 'Lax', 'None'].includes(sameSite) ? sameSite : 'Lax',
  };
}

const thumbtackCookies = raw
  .filter((c) => (c.domain ?? '').includes('thumbtack'))
  .map(toPlaywrightCookie);

const skipped = raw.length - thumbtackCookies.length;
console.log(`Found ${thumbtackCookies.length} thumbtack.com cookie(s) to import` + (skipped ? ` (skipped ${skipped} unrelated cookie(s)).` : '.'));

if (thumbtackCookies.length === 0) {
  console.error('Nothing to import — check the export actually covers thumbtack.com.');
  process.exit(1);
}

async function main() {
  fs.mkdirSync(profileDir, { recursive: true });
  const context = await chromium.launchPersistentContext(profileDir, { headless: true });
  await context.addCookies(thumbtackCookies);
  await context.close();
  console.log('Imported into the reused browser profile at', profileDir);
  console.log('Delete the export file now — it contains live session cookies:', inputPath);
}

main();
