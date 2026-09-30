const path = require('node:path');
async function build() {
  const { packager } = await import('@electron/packager');
  const outputs = await packager({
    dir: path.join(__dirname, '..'), name: 'MdView', platform: 'win32', arch: 'x64',
    out: path.join(__dirname, '..', 'dist', new Date().toISOString().replace(/[:.]/g, '-')),
    asar: true, prune: true,
    icon: path.join(__dirname, '..', 'src', 'assets', 'mdview.ico'),
    download: { checksums: require('electron/checksums.json') },
    // Only application inputs may enter the package. In particular, never traverse
    // adjacent portable profiles, loose installers, credentials or workspace files.
    ignore: file => file !== '' && file !== '/' && !/^\/(?:src|test|examples|node_modules)(?:\/|$)/.test(file) && file !== '/package.json',
    win32metadata: { CompanyName: 'MdView', FileDescription: 'MdView Markdown Reader', ProductName: 'MdView' }
  });
  console.log(`Windows 应用：${outputs.join('\n')}`);
  return outputs[0];
}
module.exports = build;
if (require.main === module) build().catch(error => { console.error(error); process.exitCode = 1; });
