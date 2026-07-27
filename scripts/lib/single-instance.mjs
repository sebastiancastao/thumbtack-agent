import fs from 'node:fs';
import path from 'node:path';

const lockPath = path.resolve('auth', 'thumbtack-window.lock');

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Returns true if the lock was acquired (no other instance is driving the
// shared browser profile), false if another instance already holds it.
export function tryAcquireLock() {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  if (fs.existsSync(lockPath)) {
    const { pid } = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
    if (isPidAlive(pid)) return false;
  }
  fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
  return true;
}

export function releaseLock() {
  try {
    fs.unlinkSync(lockPath);
  } catch {
    // already gone
  }
}
