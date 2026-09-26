'use strict';
const net = require('node:net');

function publicIPv4(ip) {
  if (net.isIP(ip) !== 4) return false; // IPv6 intentionally unsupported; no transition-address ambiguity.
  const [a, b, c] = ip.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113));
}
function validateTarget(value) {
  if (!value || typeof value !== 'object' || Object.keys(value).sort().join() !== 'hostname,protocol') return null;
  const { hostname, protocol } = value;
  if (!['http:', 'https:'].includes(protocol) || typeof hostname !== 'string' || hostname.length > 253 || hostname !== hostname.toLowerCase()) return null;
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname)) return null;
  if (/(?:^|\.)(?:localhost|local|internal|lan|home|home\.arpa|onion|test|invalid|example)$/.test(hostname)) return null;
  return { hostname, protocol };
}
const MAX_BYTES = 256 * 1024;
function pngSize(buffer) {
  if (buffer.length < 33 || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || buffer.readUInt32BE(8) !== 13 || buffer.toString('ascii', 12, 16) !== 'IHDR') return false;
  const w = buffer.readUInt32BE(16), h = buffer.readUInt32BE(20);
  return w > 0 && h > 0 && w <= 512 && h <= 512 && w * h <= 65536;
}
function normalizeRaster(buffer, nativeImage) {
  try {
    if (!Buffer.isBuffer(buffer) || buffer.length > MAX_BYTES) return null;
    // Only PNG and PNG-backed ICO entries: reject SVG, animation, DIB and all other formats.
    if (!pngSize(buffer)) {
      if (buffer.length < 22 || buffer.readUInt32LE(0) !== 65536) return null;
      const count = buffer.readUInt16LE(4);
      if (!count || count > 32 || 6 + count * 16 > buffer.length) return null;
      let selected;
      for (let i = 0; i < count; i++) {
        const pos = 6 + i * 16, size = buffer.readUInt32LE(pos + 8), offset = buffer.readUInt32LE(pos + 12);
        if (offset < 6 + count * 16 || size > MAX_BYTES || offset + size > buffer.length) return null;
        const entry = buffer.subarray(offset, offset + size);
        if (!selected && pngSize(entry)) selected = entry;
      }
      if (!selected) return null;
      buffer = selected;
    }
    // Reject APNG explicitly before native decoding; bound the chunk walk too.
    let end = false;
    for (let offset = 8; offset + 12 <= buffer.length;) {
      const length = buffer.readUInt32BE(offset), kind = buffer.toString('ascii', offset + 4, offset + 8);
      if (length > buffer.length - offset - 12 || kind === 'acTL') return null;
      offset += length + 12;
      if (kind === 'IEND') { end = offset === buffer.length; break; }
    }
    if (!end) return null;
    const image = nativeImage.createFromBuffer(buffer);
    if (image.isEmpty()) return null;
    const { width, height } = image.getSize();
    if (!width || !height || width > 512 || height > 512 || width * height > 65536) return null;
    const png = image.resize({ width: 16, height: 16, quality: 'good' }).toPNG();
    if (!pngSize(png) || png.length > 16 * 1024) return null;
    return `data:image/png;base64,${png.toString('base64')}`;
  } catch { return null; }
}
function createService({ nativeImage, resolve = require('node:dns').promises.lookup,
  request = (options, callback) => require(options.protocol === 'https:' ? 'node:https' : 'node:http').request(options, callback),
  concurrency = 4, maxPending = 128, maxCache = 128, timeoutMs = 5000, ttlMs = 30 * 60 * 1000 } = {}) {
  const cache = new Map(), pending = new Map(), queue = [], cancellations = new Set();
  let active = 0, disposed = false;
  function fetchIcon(target) {
    return new Promise(done => {
      let finished = false, req, response;
      const finish = value => {
        if (finished) return;
        finished = true; clearTimeout(timer); cancellations.delete(cancel);
        response?.destroy(); req?.destroy(); done(value);
      };
      const cancel = () => finish(null);
      const timer = setTimeout(cancel, timeoutMs);
      cancellations.add(cancel);
      Promise.resolve().then(() => resolve(target.hostname, { all: true, family: 4, verbatim: true })).then(addresses => {
        if (finished) return;
        if (!Array.isArray(addresses) || !addresses.length || addresses.some(a => a.family !== 4 || !publicIPv4(a.address))) return finish(null);
        const pinned = addresses[0].address;
        req = request({ protocol: target.protocol, hostname: target.hostname,
          port: target.protocol === 'https:' ? 443 : 80, servername: target.hostname,
          method: 'GET', path: '/favicon.ico', agent: false, family: 4, autoSelectFamily: false,
          rejectUnauthorized: true, maxHeaderSize: 8192,
          lookup: (_host, options, callback) => callback(null, options?.all ? [{ address: pinned, family: 4 }] : pinned, 4),
          headers: { Accept: 'image/png,image/x-icon', 'Accept-Encoding': 'identity', 'User-Agent': 'MdView-LinkIcons', Connection: 'close' }
        }, res => {
          response = res;
          res.on('error', cancel); res.on('aborted', cancel);
          if (finished) { res.destroy(); return; }
          if (res.statusCode !== 200 || (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') || Number(res.headers['content-length'] || 0) > MAX_BYTES) return finish(null);
          const chunks = []; let bytes = 0;
          res.on('data', chunk => {
            if (finished) return;
            bytes += chunk.length;
            if (bytes > MAX_BYTES) return finish(null);
            chunks.push(chunk);
          });
          res.on('end', () => { if (!finished) finish(normalizeRaster(Buffer.concat(chunks), nativeImage)); });
        });
        req.on('error', cancel);
        req.end();
      }).catch(cancel);
    });
  }
  function pump() {
    while (!disposed && active < concurrency && queue.length) {
      const job = queue.shift(); active++;
      fetchIcon(job.target).then(value => {
        if (!disposed) {
          cache.set(job.key, { value, until: Date.now() + ttlMs });
          while (cache.size > maxCache) cache.delete(cache.keys().next().value);
        }
        active--; pending.delete(job.key); job.done(value); pump();
      });
    }
  }
  return {
    get(value) {
      const target = validateTarget(value);
      if (disposed || !target) return Promise.resolve(null);
      const key = target.protocol + '//' + target.hostname, hit = cache.get(key);
      if (hit && hit.until > Date.now()) return Promise.resolve(hit.value);
      cache.delete(key);
      if (pending.has(key)) return pending.get(key);
      if (pending.size >= maxPending) return Promise.resolve(null);
      let done; const promise = new Promise(resolve => { done = resolve; });
      pending.set(key, promise); queue.push({ key, target, done }); pump(); return promise;
    },
    stats: () => ({ active, pending: pending.size, cache: cache.size }),
    dispose() { disposed = true; for (const cancel of cancellations) cancel(); for (const job of queue.splice(0)) job.done(null); pending.clear(); cache.clear(); }
  };
}
function install(win, trusted, dependencies = {}) {
  const electron = dependencies.electron || require('electron');
  const service = createService({ nativeImage: electron.nativeImage, ...dependencies });
  electron.ipcMain.handle('link-icon', (event, target) => { trusted(event); return service.get(target); });
  win.once('closed', () => { service.dispose(); electron.ipcMain.removeHandler('link-icon'); });
  return service;
}
module.exports = { publicIPv4, validateTarget, normalizeRaster, createService, install };
