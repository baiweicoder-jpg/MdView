// No clipboard polling, paths, network or filesystem writes: this endpoint only
// normalizes bytes supplied by an explicit renderer paste event.
const MAX_INPUT = 8 * 1024 * 1024;
const MAX_PNG = 2 * 1024 * 1024;
const MAX_DIMENSION = 8192;
const MAX_PIXELS = 16 * 1024 * 1024;
const PREFIX = 'data:image/png;base64,';
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function dimensionsAllowed(width, height) {
  return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width <= MAX_DIMENSION && height <= MAX_DIMENSION && width * height <= MAX_PIXELS;
}
function validatePng(data, limit = MAX_PNG) {
  if (!Buffer.isBuffer(data) || data.length > limit || data.length < 45 || !data.subarray(0, 8).equals(SIGNATURE) || data.readUInt32BE(8) !== 13 || data.toString('ascii', 12, 16) !== 'IHDR' || !dimensionsAllowed(data.readUInt32BE(16), data.readUInt32BE(20))) throw Error('图片必须是有效且尺寸受限的 PNG。');
  // Walk bounded chunks; reject trailing payloads, animation and truncated files.
  let offset = 8, idat = false;
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.toString('ascii', offset + 4, offset + 8);
    if (length > data.length - offset - 12 || type === 'acTL') throw Error('PNG 数据无效。');
    if (type === 'IDAT') idat = true;
    offset += length + 12;
    if (type === 'IEND') {
      if (length !== 0 || offset !== data.length || !idat) throw Error('PNG 数据无效。');
      return data;
    }
  }
  throw Error('PNG 数据不完整。');
}
function validateEmbeddedPng(url) {
  if (typeof url !== 'string' || !url.startsWith(PREFIX) || url.length > PREFIX.length + 4 * Math.ceil(MAX_PNG / 3)) throw Error('嵌入图片超过 2 MB 或格式无效。');
  const encoded = url.slice(PREFIX.length);
  // Canonical base64 only; no whitespace, %-escaping, alternate MIME or params.
  if (!encoded || encoded.length % 4 || /[^A-Za-z0-9+/=]/.test(encoded)) throw Error('图片编码无效。');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded) throw Error('图片编码无效。');
  return validatePng(bytes);
}
function normalizePng(bytes, nativeImage) {
  if (!(bytes instanceof Uint8Array) && !Array.isArray(bytes)) throw Error('图片字节无效。');
  if (!bytes.length || bytes.length > MAX_INPUT || (Array.isArray(bytes) && !bytes.every(value => Number.isInteger(value) && value >= 0 && value <= 255))) throw Error('图片输入超过 8 MB 或字节无效。');
  const input = validatePng(Buffer.from(bytes), MAX_INPUT);
  const image = nativeImage.createFromBuffer(input);
  if (image.isEmpty()) throw Error('无法解码 PNG 图片。');
  const { width, height } = image.getSize();
  if (!dimensionsAllowed(width, height)) throw Error('图片尺寸过大。');
  const png = validatePng(image.toPNG());
  return { dataUrl: PREFIX + png.toString('base64'), bytes: png.length, width, height };
}
function registerImagePaste(trusted, electron = require('electron')) {
  electron.ipcMain.handle('paste-image', (event, bytes) => {
    if (trusted(event) === false) return { ok: false, message: '不受信任的请求。' };
    try { return { ok: true, ...normalizePng(bytes, electron.nativeImage) }; }
    catch (error) { return { ok: false, message: error.message }; }
  });
}
module.exports = { registerImagePaste, normalizePng, validateEmbeddedPng, validatePng, MAX_INPUT, MAX_PNG, MAX_DIMENSION, MAX_PIXELS };
