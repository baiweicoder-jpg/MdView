const fs = require('node:fs/promises');
const path = require('node:path');

if (!process.versions.electron) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = require('node:child_process').spawn(require('electron'), [__filename], { env, stdio: 'inherit', windowsHide: true });
  child.on('error', error => { console.error(error); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
} else {
  const { app, BrowserWindow } = require('electron');
  app.disableHardwareAcceleration();
  app.setPath('userData', path.join(app.getPath('temp'), `mdview-icons-${process.pid}`));
  app.whenReady().then(async () => {
    const directory = path.join(__dirname, '..', 'src', 'assets');
    const svg = await fs.readFile(path.join(directory, 'mdview.svg'));
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, offscreen: true } });
    await win.loadURL('data:text/html,<html></html>');
    const sizes = [16, 24, 32, 48, 64, 128, 256];
    const pngs = [];
    for (const size of sizes) {
      const data = await win.webContents.executeJavaScript(`(async () => {
        const image = new Image();
        image.src = ${JSON.stringify(`data:image/svg+xml;base64,${svg.toString('base64')}`)};
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = ${size};
        canvas.getContext('2d').drawImage(image, 0, 0, ${size}, ${size});
        return canvas.toDataURL('image/png').split(',')[1];
      })()`);
      pngs.push(Buffer.from(data, 'base64'));
    }
    const header = Buffer.alloc(6 + sizes.length * 16);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(sizes.length, 4);
    let offset = header.length;
    pngs.forEach((png, index) => {
      const entry = 6 + index * 16;
      header[entry] = header[entry + 1] = sizes[index] % 256;
      header.writeUInt16LE(1, entry + 4);
      header.writeUInt16LE(32, entry + 6);
      header.writeUInt32LE(png.length, entry + 8);
      header.writeUInt32LE(offset, entry + 12);
      offset += png.length;
    });
    await fs.writeFile(path.join(directory, 'mdview.ico'), Buffer.concat([header, ...pngs]));
    await fs.writeFile(path.join(directory, 'mdview.png'), pngs.at(-1));
    console.log('Generated MdView PNG and Windows ICO (16–256 px) from SVG.');
    app.exit(0);
  }).catch(error => { console.error(error); app.exit(1); });
}
