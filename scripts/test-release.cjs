const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { createHash } = require('node:crypto');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
function execute(file, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, env, windowsHide: true, stdio: 'inherit' });
    const timer = setTimeout(() => reject(Error(`Timed out: ${file}; process retained for inspection`)), 180000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => { clearTimeout(timer); resolve(code); });
  });
}
function installedExecutable() {
  return execFileSync('powershell.exe', ['-NoProfile', '-Command', "[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' | Get-ItemProperty | Where-Object DisplayName -Match '^MdView(?: |$)' | Select-Object -ExpandProperty DisplayIcon"], { encoding: 'utf8', windowsHide: true }).trim().replace(/,0$/, '');
}
async function test() {
  assert(process.argv[2], 'Pass the release output directory');
  const resume = process.argv.includes('--installed');
  if (!resume) assert.equal(installedExecutable(), '', 'An existing installation must not be overwritten by this first-install test');
  const release = path.resolve(process.argv[2]);
  const names = await fs.readdir(release);
  const setup = path.join(release, names.find(name => /-Setup-x64\.exe$/.test(name)));
  const portable = path.join(release, names.find(name => /-Portable-x64\.exe$/.test(name)));
  const root = path.resolve('artifacts', `release-${Date.now()}`);
  await fs.mkdir(root, { recursive: true });
  if (!resume) assert.equal(await execute(setup, ['/S'], root), 0, 'one-click installer exit code');
  const installed = installedExecutable();
  assert((await fs.stat(installed)).isFile());
  const hash = async file => createHash('sha256').update(await fs.readFile(file)).digest('hex');
  assert.equal(await hash(path.join(path.dirname(installed), 'resources/app.asar')), await hash(path.join(release, 'MdView-win32-x64/resources/app.asar')), 'installed application matches this release');
  assert.equal(await execute(installed, ['--smoke-test'], root), 0, 'installed application smoke test');
  assert((await fs.stat(path.join(root, 'artifacts/packaged/editor.png'))).size > 0);
  const portableRoot = path.join(root, 'portable test');
  await fs.mkdir(portableRoot);
  const portableCopy = path.join(portableRoot, path.basename(portable));
  await fs.copyFile(portable, portableCopy);
  assert.equal(await execute(portableCopy, ['--smoke-test'], portableRoot), 0, 'portable launcher forwards arguments and exit code');
  assert((await fs.stat(path.join(portableRoot, 'MdView-data/Local State'))).size > 0, 'portable preferences stay beside EXE');
  // NSIS runs the app in a temporary working directory and removes it on exit.
  // Its forwarded exit code verifies the smoke suite; only portable user data persists.
  const normal = spawn(installed, [], { env, detached: true, windowsHide: false, stdio: 'ignore' });
  normal.unref();
  await delay(4000);
  assert.equal(await execute(setup, ['/S'], root), 10, 'installer refuses to terminate a running editor');
  process.kill(normal.pid, 0);
  const report = { installed, normalPid: normal.pid, installer: 'passed', installedSmoke: 'passed', portableSmoke: 'passed', portableSettings: 'beside EXE', runningEditorProtection: 'passed' };
  await fs.writeFile(path.join(root, 'release-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, reportDirectory: root }, null, 2));
}
test().catch(error => { console.error(error); process.exitCode = 1; });
