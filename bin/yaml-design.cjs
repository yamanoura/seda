#!/usr/bin/env node
// 古いNode.jsがPATHの先頭にある環境でも、利用可能な対応版を探す。
const { spawnSync } = require('child_process');
const { delimiter, join } = require('path');
let executable = process.execPath;
if (Number(process.versions.node.split('.')[0]) < 20) {
  executable = undefined;
  for (const directory of (process.env.PATH || '').split(delimiter).filter(Boolean)) {
    const candidate = join(directory, process.platform === 'win32' ? 'node.exe' : 'node');
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8', timeout: 3000 });
    if (probe.status === 0 && Number((probe.stdout.match(/^v(\d+)\./) || [])[1]) >= 20) {
      executable = candidate;
      break;
    }
  }
}
if (!executable) {
  console.error('ERROR sedaにはNode.js 20以上が必要です。インストールしてPATHに追加してください。');
  process.exitCode = 2;
} else {
  const child = spawnSync(executable, [join(__dirname, '../src/cli.js'), ...process.argv.slice(2)], { stdio: 'inherit' });
  if (child.error) console.error(`ERROR ${child.error.message}`);
  process.exitCode = child.status === null ? 2 : child.status;
}
