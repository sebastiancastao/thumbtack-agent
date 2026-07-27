import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export async function POST() {
  if (process.env.NODE_ENV !== "development") {
    return Response.json(
      { error: "This endpoint only runs in local development." },
      { status: 403 }
    );
  }

  const profileDir = path.join(process.cwd(), "auth", "thumbtack-profile");
  if (!fs.existsSync(profileDir)) {
    return Response.json(
      { error: "No saved session yet. Log in first." },
      { status: 400 }
    );
  }

  const logDir = path.join(process.cwd(), "logs");
  fs.mkdirSync(logDir, { recursive: true });
  const logFd = fs.openSync(path.join(logDir, "agent.log"), "a");

  const scriptPath = path.join(process.cwd(), "scripts", "thumbtack-agent.mjs");
  const child = spawn(process.execPath, [scriptPath], {
    cwd: process.cwd(),
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();

  return Response.json({ started: true, message: "Agent launched using the saved session." });
}
