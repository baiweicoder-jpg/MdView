const path = require('node:path');
const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { build, Platform, Arch } = require('electron-builder');

async function release() {
  const unpacked = await require('./package.cjs')();
  const output = path.dirname(unpacked);
  const artifacts = await build({
    targets: Platform.WINDOWS.createTarget(['nsis', 'portable'], Arch.x64),
    prepackaged: unpacked,
    publish: 'never',
    config: {
      appId: 'com.mdview.desktop', productName: 'MdView',
      directories: { output },
      win: { icon: 'src/assets/mdview.ico', executableName: 'MdView' },
      nsis: {
        include: 'build/installer.nsh',
        artifactName: 'MdView-${version}-Setup-${arch}.${ext}',
        oneClick: true, perMachine: false, allowElevation: false,
        createDesktopShortcut: true, createStartMenuShortcut: true,
        shortcutName: 'MdView', runAfterFinish: true,
        deleteAppDataOnUninstall: false,
        installerLanguages: ['zh_CN', 'en_US'], language: '2052'
      },
      portable: { artifactName: 'MdView-${version}-Portable-${arch}.${ext}', requestExecutionLevel: 'user' }
    }
  });
  const executables = artifacts.filter(file => file.endsWith('.exe'));
  const checksums = await Promise.all(executables.map(async file => `${createHash('sha256').update(await fs.readFile(file)).digest('hex')}  ${path.basename(file)}`));
  await fs.writeFile(path.join(output, 'SHA256SUMS.txt'), checksums.join('\n') + '\n');
  console.log(`发行产物：\n${executables.join('\n')}`);
}
release().catch(error => { console.error(error); process.exitCode = 1; });
