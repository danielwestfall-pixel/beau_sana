import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rename, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const script = `
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Security
  $inputData = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $bytes = [Convert]::FromBase64String($inputData.data)
  $entropy = [Text.Encoding]::UTF8.GetBytes('BeauSana token v1')
  if ($inputData.operation -eq 'protect') {
    $result = [Security.Cryptography.ProtectedData]::Protect($bytes, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  } else {
    $result = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  }
  [Console]::Out.Write([Convert]::ToBase64String($result))
} catch { exit 1 }
`;
export function windowsCrypt(operation, data) {
  return new Promise((resolve, reject) => {
    const child = spawn(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    let output = ''; const fail = () => reject(new Error('Windows could not protect or read the saved token.'));
    const timer = setTimeout(() => { child.kill(); fail(); }, 15000);
    child.stdout.on('data', chunk => { output += chunk; if (output.length > 32768) child.kill(); });
    child.on('error', () => { clearTimeout(timer); fail(); });
    child.stdin.on('error', () => {});
    child.on('close', code => { clearTimeout(timer); if (code !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(output)) fail(); else resolve(Buffer.from(output, 'base64')); });
    // Secret data travels through stdin, never command-line arguments or logs.
    child.stdin.end(JSON.stringify({ operation, data: data.toString('base64') }));
  });
}
export class CredentialStore {
  constructor({ directory = process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'BeauSana'), platform = process.platform, crypt = windowsCrypt } = {}) {
    this.supported = platform === 'win32' && !!directory; this.directory = directory;
    this.path = directory && join(directory, 'token.dpapi'); this.crypt = crypt;
  }
  async exists() {
    if (!this.supported) return false;
    try { await stat(this.path); return true; } catch (err) { if (err.code === 'ENOENT') return false; throw err; }
  }
  async save(token) {
    if (!this.supported) throw new Error('Saving tokens requires Windows.');
    const encrypted = await this.crypt('protect', Buffer.from(token));
    await mkdir(this.directory, { recursive: true });
    const temporary = this.path + '.' + randomBytes(8).toString('hex') + '.tmp';
    try { await writeFile(temporary, encrypted, { flag: 'wx', mode: 0o600 }); await rename(temporary, this.path); }
    finally { await unlink(temporary).catch(err => { if (err.code !== 'ENOENT') throw err; }); }
  }
  async load() {
    if (!this.supported) throw new Error('Saving tokens requires Windows.');
    if ((await stat(this.path)).size > 16384) throw new Error('The saved token file is invalid.');
    const token = (await this.crypt('unprotect', await readFile(this.path))).toString('utf8');
    if (!token.trim() || token.length > 4096) throw new Error('The saved token file is invalid.');
    return token;
  }
  async forget() {
    if (!this.supported) return;
    await unlink(this.path).catch(err => { if (err.code !== 'ENOENT') throw err; });
  }
}
