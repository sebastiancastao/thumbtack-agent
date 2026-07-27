import { execFile } from 'node:child_process';

const PS_SNIPPET = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FgWin {
    [DllImport(\\"user32.dll\\")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport(\\"user32.dll\\")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@
Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
  Where-Object { $_.CommandLine -like '*thumbtack-profile*' } |
  ForEach-Object {
    $p = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
    if ($p -and $p.MainWindowHandle -ne 0) {
      [FgWin]::ShowWindow($p.MainWindowHandle, 9) | Out-Null
      [FgWin]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
    }
  }
`;

// Chrome's window can start minimized when the dev server's own process was
// itself launched with a minimized/hidden show-window state (e.g. from a
// background task runner) — that state gets inherited by child GUI processes
// on Windows. Explicitly restoring + foregrounding works around it.
export function bringPlaywrightWindowToFront() {
  if (process.platform !== 'win32') return;
  execFile('powershell.exe', ['-NoProfile', '-Command', PS_SNIPPET], () => {});
}
