import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { CredentialEncryption } from '@siwc/local';

// Secrets travel only over private process pipes. Never put them in arguments,
// environment variables, files, PowerShell transcripts, or diagnostic output.
async function dpapi(operation: 'Protect' | 'Unprotect', input: Uint8Array): Promise<Buffer> {
  if (process.platform !== 'win32') throw new Error('OS credential protection is unavailable.');
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const script = `$ErrorActionPreference='Stop'; try { Add-Type -AssemblyName System.Security; $bytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $result=[Security.Cryptography.ProtectedData]::${operation}($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($result)) } catch { exit 1 }`;
  return new Promise((resolve, reject) => {
    const child = spawn(join(systemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
      env: { SystemRoot: systemRoot, WINDIR: systemRoot },
    });
    let output = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('OS credential protection timed out.')); }, 10_000);
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('ascii');
      if (output.length > 4 * 1024 * 1024) child.kill();
    });
    child.stdin.on('error', () => { /* Exit handler returns a fixed error. */ });
    child.once('error', () => { clearTimeout(timer); reject(new Error('OS credential protection is unavailable.')); });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 || !output || !/^[A-Za-z0-9+/]+={0,2}$/.test(output)) {
        reject(new Error('OS credential protection failed.')); return;
      }
      resolve(Buffer.from(output, 'base64'));
    });
    child.stdin.end(Buffer.from(input).toString('base64'));
  });
}

export function createWindowsCredentialEncryption(): CredentialEncryption {
  return {
    id: 'easynews-windows-dpapi-current-user-v1',
    async isAvailable() {
      try {
        const probe = Buffer.from('Easynews credential protection probe');
        return probe.equals(await dpapi('Unprotect', await dpapi('Protect', probe)));
      } catch { return false; }
    },
    encrypt: (text) => dpapi('Protect', Buffer.from(text, 'utf8')),
    decrypt: async (bytes) => (await dpapi('Unprotect', bytes)).toString('utf8'),
  };
}
