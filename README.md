This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

Note: the "Log in" / "Run agent" buttons on the dashboard only work when running locally (`npm run dev`). A deployed instance (Vercel, Supabase Edge Functions, etc.) has no display to pop a browser window into and no persistent disk/process to keep one open, so those endpoints intentionally return a 403 there. The actual production automation runs separately — see below.

## Running the agent automatically in production

The message-check-and-reply loop can't run inside Vercel or Supabase Edge Functions — both are serverless with no room to launch a real Chromium process (Supabase Edge Functions specifically cap out at 256MB memory and don't support subprocesses at all). Instead, it runs on a **GitHub Actions schedule**, using a saved login session instead of the interactive login:

1. **Log in locally** (one-time, or whenever the session expires):
   ```bash
   npm run login:thumbtack
   ```
   Complete the password/2FA/verification yourself in the window that opens.

2. **Export the session** to a portable file:
   ```bash
   npm run export:thumbtack-session
   ```
   This writes `auth/session-state.json` (cookies + localStorage, no password).

3. **Save it as a GitHub secret**: repo Settings → Secrets and variables → Actions → New repository secret, named `THUMBTACK_STORAGE_STATE`, value = the entire contents of that file. Then delete the local file — it contains live session cookies.

4. That's it — [.github/workflows/thumbtack-agent.yml](.github/workflows/thumbtack-agent.yml) runs `scripts/thumbtack-agent-headless.mjs` every 15 minutes on GitHub's runners, headless, using that saved session. You can also trigger it manually from the Actions tab (`workflow_dispatch`).

5. If a run fails with "SESSION EXPIRED" (GitHub will show the workflow as failed), repeat steps 1–3 to refresh the secret.

To test the headless path locally before trusting it in CI:
```bash
$env:THUMBTACK_STORAGE_STATE = Get-Content auth/session-state.json -Raw
npm run agent:thumbtack:headless
```
