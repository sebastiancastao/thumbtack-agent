"use client";

import { useEffect, useState } from "react";

type Status = { hasSession: boolean; savedAt: string | null };

export default function Home() {
  const [status, setStatus] = useState<Status | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState<"login" | "agent" | null>(null);

  const refreshStatus = () => {
    fetch("/api/thumbtack/status")
      .then((res) => res.json())
      .then(setStatus)
      .catch(() => setStatus(null));
  };

  useEffect(() => {
    refreshStatus();
  }, []);

  async function trigger(kind: "login" | "agent") {
    setLoading(kind);
    setMessage(null);
    try {
      const res = await fetch(`/api/thumbtack/${kind}`, { method: "POST" });

      if (res.status === 403 && kind === "login") {
        // This isn't running locally, so the server can't pop a Playwright
        // window on anyone's screen (and couldn't persist a session for the
        // agent step even if it could). Fall back to just opening Thumbtack's
        // real login page in a normal browser tab so you can at least sign
        // in and look around — the automated "Run agent" step still needs
        // the project running locally (`npm run dev` + `npm run
        // login:thumbtack`) since that's what saves a reusable session.
        window.open("https://www.thumbtack.com/login", "_blank", "noopener,noreferrer");
        setMessage(
          "This is a deployed instance, so it can't launch a browser on your machine or save a session here. Opened thumbtack.com/login in a new tab instead — to run the automated agent, clone and run this project locally with `npm run dev`."
        );
        return;
      }

      const data = await res.json();
      setMessage(data.message ?? data.error ?? "Done.");
    } catch {
      setMessage("Request failed. Is `npm run dev` running locally?");
    } finally {
      setLoading(null);
      setTimeout(refreshStatus, 2000);
    }
  }

  return (
    <div className="flex flex-col flex-1 items-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-full max-w-xl flex-col gap-8 py-24 px-8">
        <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
          Thumbtack agent
        </h1>

        <section className="flex flex-col gap-3 rounded-xl border border-black/[.08] p-5 dark:border-white/[.145]">
          <h2 className="font-medium text-black dark:text-zinc-50">1. Log in (manual)</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Opens a real browser window with your email/password pre-filled. You complete
            any human verification / 2FA yourself; once you&apos;re past the login page the
            session is saved for reuse.
          </p>
          <button
            onClick={() => trigger("login")}
            disabled={loading !== null}
            className="w-fit rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
          >
            {loading === "login" ? "Launching..." : "Open login window"}
          </button>
        </section>

        <section className="flex flex-col gap-3 rounded-xl border border-black/[.08] p-5 dark:border-white/[.145]">
          <h2 className="font-medium text-black dark:text-zinc-50">2. Run agent</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Reuses the saved session (no login form, no verification wall) to open the
            Thumbtack pro dashboard.
          </p>
          <button
            onClick={() => trigger("agent")}
            disabled={loading !== null || !status?.hasSession}
            className="w-fit rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
          >
            {loading === "agent" ? "Launching..." : "Run agent"}
          </button>
        </section>

        <section className="text-sm text-zinc-600 dark:text-zinc-400">
          <p>
            Session status:{" "}
            {status?.hasSession
              ? `saved (${new Date(status.savedAt!).toLocaleString()})`
              : "none yet"}
          </p>
          {message && <p className="mt-2 text-black dark:text-zinc-50">{message}</p>}
        </section>
      </main>
    </div>
  );
}
