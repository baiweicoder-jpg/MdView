const path = require('node:path');
async function build() {
  const { packager } = await import('@electron/packager');
  const outputs = await packager({
    dir: path.join(__dirname, '..'), name: 'MdView', platform: 'win32', arch: 'x64',
    out: path.join(__dirname, '..', 'dist', new Date().toISOString().replace(/[:.]/g, '-')),
    asar: true, prune: true,
    ignore: [/^\/artifacts($|\/)/, /^\/dist($|\/)/, /^\/scripts($|\/)/],
    win32metadata: { CompanyName: 'MdView', FileDescription: 'MdView Markdown Reader', ProductName: 'MdView' }
  });
  console.log(`Windows 应用：${outputs.join('\n')}`);
}
build().catch(error => { console.error(error); process.exitCode = 1; });
