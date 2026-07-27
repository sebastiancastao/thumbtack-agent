import fs from "node:fs";
import path from "node:path";

export async function GET() {
  const profileDir = path.join(process.cwd(), "auth", "thumbtack-profile");
  const exists = fs.existsSync(profileDir);
  const savedAt = exists ? fs.statSync(profileDir).mtime.toISOString() : null;

  return Response.json({ hasSession: exists, savedAt });
}
