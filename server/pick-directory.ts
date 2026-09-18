import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * Open a native folder dialog. Returns null when the user cancels.
 * Uses osascript (macOS), zenity (Linux), or PowerShell (Windows).
 */
export async function pickDirectory(prompt: string): Promise<string | null> {
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await execFileAsync('osascript', [
        '-e',
        `POSIX path of (choose folder with prompt ${JSON.stringify(prompt)})`,
      ])
      const chosen = stdout.trim()
      return chosen ? chosen.replace(/\/$/, '') : null
    } catch {
      return null
    }
  }

  if (process.platform === 'linux') {
    try {
      const { stdout } = await execFileAsync('zenity', [
        '--file-selection',
        '--directory',
        `--title=${prompt}`,
      ])
      const chosen = stdout.trim()
      return chosen || null
    } catch {
      return null
    }
  }

  if (process.platform === 'win32') {
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
      `$d.Description = ${JSON.stringify(prompt)}`,
      'if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {',
      '  Write-Output $d.SelectedPath',
      '}',
    ].join('; ')
    try {
      const { stdout } = await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-Command',
        script,
      ])
      const chosen = stdout.trim()
      return chosen || null
    } catch {
      return null
    }
  }

  throw Object.assign(new Error('Directory picker is not supported on this platform'), {
    status: 501,
  })
}
