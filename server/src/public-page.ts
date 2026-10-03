import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { safeUrl } from './related-types.js';

const blocked = new BlockList();
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]] as const) blocked.addSubnet(address, prefix);
blocked.addSubnet('2001::', 23, 'ipv6');
blocked.addSubnet('2002::', 16, 'ipv6');
blocked.addSubnet('2001:db8::', 32, 'ipv6');
const globalV6 = new BlockList(); globalV6.addSubnet('2000::', 3, 'ipv6');
export function publicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  return family === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
}
export async function resolvePublicPage(value: string, signal: AbortSignal) {
  if (!safeUrl(value)) throw new Error('Invalid metadata URL.');
  const url = new URL(value);
  if (url.port && url.port !== (url.protocol === 'https:' ? '443' : '80')) throw new Error('Invalid metadata port.');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  signal.throwIfAborted();
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await lookup(hostname, { all: true });
  signal.throwIfAborted();
  if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) throw new Error('Non-public metadata destination.');
  return { url, address: addresses[0]! };
}

// No cookies, authorization, page cache or logs. Validate every redirect and pin
// the DNS result used by the socket so a later resolution cannot reach localhost.
export async function readPublicPage(value: string, signal: AbortSignal): Promise<string> {
  const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(5_000)]);
  // DNS cannot be cancelled by node:dns; bound the caller's wait as well.
  const run = async () => {
    let destination = value;
    for (let redirects = 0; redirects <= 3; redirects++) {
      const { url, address } = await resolvePublicPage(destination, boundedSignal);
      const result = await new Promise<{ html?: string; location?: string }>((resolve, reject) => {
        const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
          method: 'GET', signal: boundedSignal, agent: false,
          headers: { Accept: 'text/html,application/xhtml+xml', 'Accept-Encoding': 'identity', 'Cache-Control': 'no-cache', 'User-Agent': 'Easynews/0.2 (article metadata)' },
          lookup: (_hostname, options, callback) => {
            if (options.all) callback(null, [address]); else callback(null, address.address, address.family);
          },
        }, (response) => {
          if (response.statusCode && [301, 302, 303, 307, 308].includes(response.statusCode)) {
            const location = response.headers.location;
            response.destroy(); resolve({ location }); return;
          }
          if (response.statusCode !== 200 || !/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(response.headers['content-type'] || '')
            || response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') {
            response.destroy(); reject(new Error('Metadata unavailable.')); return;
          }
          const chunks: Buffer[] = []; let size = 0; let done = false;
          const finish = () => {
            if (done) return; done = true;
            const bytes = Buffer.concat(chunks);
            const charset = response.headers['content-type']?.match(/charset\s*=\s*["']?([^\s;"']+)/i)?.[1]
              || bytes.subarray(0, 4096).toString('ascii').match(/charset\s*=\s*["']?([^\s;"'>]+)/i)?.[1] || 'utf-8';
            try { resolve({ html: new TextDecoder(charset).decode(bytes) }); }
            catch { resolve({ html: bytes.toString('utf8') }); }
          };
          response.on('data', (chunk: Buffer) => {
            const part = chunk.subarray(0, 512 * 1024 - size); chunks.push(part); size += part.length;
            if (size >= 512 * 1024) { finish(); response.destroy(); }
          });
          response.on('end', finish);
          response.on('error', reject);
          response.on('aborted', () => { if (!done) reject(new Error('Metadata interrupted.')); });
        });
        request.on('error', reject); request.end();
      });
      if (result.html !== undefined) return result.html;
      if (!result.location) throw new Error('Metadata redirect unavailable.');
      destination = new URL(result.location, url).href;
    }
    throw new Error('Too many metadata redirects.');
  };
  return new Promise((resolve, reject) => {
    const abort = () => reject(boundedSignal.reason);
    boundedSignal.addEventListener('abort', abort, { once: true });
    if (boundedSignal.aborted) { abort(); boundedSignal.removeEventListener('abort', abort); return; }
    run().then(resolve, reject).finally(() => boundedSignal.removeEventListener('abort', abort));
  });
}
