const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateTarget, publicIPv4, createService, normalizeRaster } = require('../src/link-icons.cjs');

test('accepts only a protocol and a canonical public DNS hostname', () => {
  assert.deepEqual(validateTarget({ protocol: 'https:', hostname: 'www.electronjs.org' }), { protocol: 'https:', hostname: 'www.electronjs.org' });
  for (const hostname of ['localhost', 'x.local', 'x.internal', 'x.localhost', '127.0.0.1', '2130706433', '[::1]', 'user@site.com', 'site.com/path', 'site.com?secret', 'site.com:443', 'site.com.', '-a.com']) {
    assert.equal(validateTarget({ protocol: 'https:', hostname }), null, hostname);
  }
  assert.equal(validateTarget({ protocol: 'file:', hostname: 'site.com' }), null);
  assert.equal(validateTarget({ protocol: 'https:', hostname: 'site.com', path: '/secret' }), null);
});

test('excludes private, local, special-use and transition addresses', () => {
  for (const ip of ['0.1.2.3','10.0.0.1','100.64.1.2','127.0.0.1','169.254.169.254','172.16.0.1','192.168.1.1','192.0.0.8','192.0.2.1','192.88.99.1','198.18.0.1','198.51.100.1','203.0.113.1','224.0.0.1','255.255.255.255','::1','::ffff:8.8.8.8']) assert.equal(publicIPv4(ip), false, ip);
  assert.equal(publicIPv4('8.8.8.8'), true);
});

const { EventEmitter } = require('node:events');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', 'base64');
const image = { isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }), resize() { return this; }, toPNG: () => PNG };
const nativeImage = { createFromBuffer: () => image };
const target = hostname => ({ hostname, protocol: 'https:' });
function fixture(overrides = {}) {
  const calls = [];
  const request = (options, callback) => {
    calls.push(options);
    const req = new EventEmitter();
    req.destroy = () => { req.destroyed = true; };
    req.end = () => queueMicrotask(() => {
      const res = new EventEmitter(); res.destroy = () => {}; res.headers = overrides.headers || {};
      res.statusCode = overrides.status || 200;
      callback(res);
      if (!req.destroyed) { res.emit('data', overrides.body || PNG); res.emit('end'); }
    });
    return req;
  };
  const service = createService({ nativeImage, resolve: async () => [{ address: '8.8.8.8', family: 4 }], request, ...overrides });
  return { service, calls };
}
test('fetches fixed origin path, pins DNS, coalesces and caches', async () => {
  const { service, calls } = fixture();
  const [a, b] = await Promise.all([service.get(target('site.com')), service.get(target('site.com'))]);
  assert.match(a, /^data:image\/png;base64,/); assert.equal(a, b);
  await service.get(target('site.com')); assert.equal(calls.length, 1);
  const options = calls[0];
  assert.equal(options.path, '/favicon.ico'); assert.equal(options.agent, false);
  assert.equal(options.hostname, 'site.com'); assert.equal(options.servername, 'site.com');
  assert.equal(options.port, 443); assert.equal(options.auth, undefined);
  assert.equal(options.headers.Cookie, undefined); assert.equal(options.headers.Referer, undefined);
  options.lookup('site.com', {}, (err, address, family) => { assert.equal(err, null); assert.equal(address, '8.8.8.8'); assert.equal(family, 4); });
  options.lookup('site.com', { all: true }, (err, entries) => assert.deepEqual(entries, [{ address: '8.8.8.8', family: 4 }]));
});
test('rejects mixed private DNS answers before opening a connection', async () => {
  for (const address of ['127.0.0.1', '169.254.169.254', '::1']) {
    const { service, calls } = fixture({ resolve: async () => [{ address: '8.8.8.8', family: 4 }, { address, family: 4 }] });
    assert.equal(await service.get(target('site.com')), null); assert.equal(calls.length, 0);
  }
});
test('redirects, compression, oversized data, SVG and errors silently fail', async () => {
  for (const config of [{ status: 302 }, { headers: { 'content-encoding': 'gzip' } }, { body: Buffer.alloc(262145) }, { body: Buffer.from('<svg/>') }, { headers: { 'content-length': '9999999' } }, { resolve: async () => { throw Error('secret'); } }]) {
    const { service } = fixture(config); assert.equal(await service.get(target('site.com')), null);
  }
});
test('bounds active requests, queued work, cache and DNS timeout', async () => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  const { service, calls } = fixture({ concurrency: 1, maxPending: 2, maxCache: 1, timeoutMs: 40, resolve: () => pending });
  const first = service.get(target('one.com')); const second = service.get(target('two.com'));
  assert.equal(await service.get(target('three.com')), null);
  assert.equal(await first, null); assert.equal(await second, null);
  release([{ address: '8.8.8.8', family: 4 }]);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(calls.length, 0);
  assert.ok(service.stats().cache <= 1); assert.equal(service.stats().active, 0);
});
test('raster preflight blocks huge dimensions and malformed ICO before decoding', () => {
  let decodes = 0; const decoder = { createFromBuffer() { decodes++; return image; } };
  const huge = Buffer.from(PNG); huge.writeUInt32BE(100000, 16);
  for (const data of [huge, Buffer.from('<svg/>'), Buffer.alloc(10), Buffer.alloc(262145)]) assert.equal(normalizeRaster(data, decoder), null);
  assert.equal(decodes, 0); assert.match(normalizeRaster(PNG, decoder), /^data:image\/png;base64,/);
});

test('trust gate executes before any DNS work and cleanup removes the handler', async () => {
  const { install } = require('../src/link-icons.cjs');
  const win = new EventEmitter(); let handler, removed, lookups = 0;
  const service = install(win, event => { if (event !== 'trusted') throw Error('denied'); }, {
    electron: { nativeImage, ipcMain: { handle(name, fn) { assert.equal(name, 'link-icon'); handler = fn; }, removeHandler(name) { removed = name; } } },
    resolve: async () => { lookups++; return []; }
  });
  assert.throws(() => handler('untrusted', target('site.com')), /denied/);
  assert.equal(lookups, 0); assert.equal(await handler('trusted', target('site.com')), null); assert.equal(lookups, 1);
  win.emit('closed'); assert.equal(removed, 'link-icon'); assert.equal(await service.get(target('other.com')), null);
});
test('HTTP stays HTTP, DNS errors are negative-cached, and expiry re-resolves', async () => {
  const { service, calls } = fixture();
  await service.get({ protocol: 'http:', hostname: 'site.com' }); assert.equal(calls[0].port, 80); assert.equal(calls[0].protocol, 'http:');
  let lookups = 0;
  const bad = fixture({ ttlMs: 10, resolve: async () => { lookups++; throw Error('no'); } }).service;
  await bad.get(target('site.com')); await bad.get(target('site.com')); assert.equal(lookups, 1);
  await new Promise(r => setTimeout(r, 20)); await bad.get(target('site.com')); assert.equal(lookups, 2);
});
test('socket timeout destroys the request; dispose cancels active and queued work', async () => {
  let destroyed = 0, started = 0;
  const request = () => { started++; const req = new EventEmitter(); req.end = () => {}; req.destroy = () => { destroyed++; }; return req; };
  const { service } = fixture({ request, timeoutMs: 20, concurrency: 1 });
  assert.equal(await service.get(target('site.com')), null); assert.equal(destroyed, 1);
  const a = service.get(target('other.com')), b = service.get(target('third.com'));
  await new Promise(r => setImmediate(r)); service.dispose();
  assert.deepEqual(await Promise.all([a,b]), [null,null]); assert.equal(started, 2); assert.equal(destroyed, 2);
});
test('accepts PNG-backed ICO only and rejects native decode failure or huge decoded pixels', () => {
  const ico = Buffer.alloc(22 + PNG.length); ico.writeUInt32LE(65536, 0); ico.writeUInt16LE(1, 4);
  ico.writeUInt32LE(PNG.length, 14); ico.writeUInt32LE(22, 18); PNG.copy(ico, 22);
  assert.match(normalizeRaster(ico, nativeImage), /^data:image\/png;base64,/);
  ico.writeUInt32LE(0xffffffff, 18); assert.equal(normalizeRaster(ico, nativeImage), null);
  for (const decoder of [{ createFromBuffer() { throw Error('decode'); } }, { createFromBuffer: () => ({ isEmpty: () => true }) }, { createFromBuffer: () => ({ ...image, getSize: () => ({ width: 99999, height: 1 }) }) }]) assert.equal(normalizeRaster(PNG, decoder), null);
  const animated = Buffer.concat([PNG.subarray(0, 33), Buffer.from('000000006163544c00000000', 'hex'), PNG.subarray(33)]);
  assert.equal(normalizeRaster(animated, nativeImage), null);
});
