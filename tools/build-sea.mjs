// 打包单文件可执行程序（Node 官方 Single Executable Applications）。
// 产物：dist/resume-platform-<平台>/ 目录，里面是可执行文件 + 运行需要的 template/ public/ assets/ starter/（入门模板）examples/（示例数据）。
// 不带用户数据：用户数据默认在系统用户目录，更新时整个程序目录直接替换即可。
// 用法：node tools/build-sea.mjs [平台名，默认 <os>-<arch>]
// 需要联网（通过 npx 临时下载 esbuild 和 postject），需要 Node 22 以上。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const platform = process.platform;
const label = process.argv[2] || `${platform === 'win32' ? 'windows' : platform === 'darwin' ? 'macos' : platform}-${process.arch}`;
const dist = path.join(root, 'dist');
const work = path.join(dist, '.build');
const outDir = path.join(dist, 'resume-platform-' + label);
const exeName = platform === 'win32' ? 'resume-platform.exe' : 'resume-platform';
const npx = platform === 'win32' ? 'npx.cmd' : 'npx';
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', shell: platform === 'win32' });

fs.rmSync(work, { recursive: true, force: true });
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

// 1. 打成一个 CommonJS 文件（SEA 入口要求单个脚本）
const bundle = path.join(work, 'app.cjs');
run(npx, ['--yes', 'esbuild@0.24.2', 'cli.mjs', '--bundle', '--platform=node', '--format=cjs', '--target=node22',
  '--log-level=error', '--outfile=' + bundle]);

// 2. 生成 SEA blob
const blob = path.join(work, 'sea-prep.blob');
const seaConfig = path.join(work, 'sea-config.json');
fs.writeFileSync(seaConfig, JSON.stringify({ main: bundle, output: blob, disableExperimentalSEAWarning: true, useCodeCache: false }, null, 2));
run(process.execPath, ['--experimental-sea-config', seaConfig]);

// 3. 复制当前 node 可执行文件并注入 blob
const exe = path.join(outDir, exeName);
fs.copyFileSync(process.execPath, exe);
fs.chmodSync(exe, 0o755);
if (platform === 'darwin') run('codesign', ['--remove-signature', exe]);
const postjectArgs = ['--yes', 'postject@1.0.0-alpha.6', exe, 'NODE_SEA_BLOB', blob,
  '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'];
if (platform === 'darwin') postjectArgs.push('--macho-segment-name', 'NODE_SEA');
run(npx, postjectArgs);
if (platform === 'darwin') run('codesign', ['--sign', '-', exe]);

// 4. 运行时需要的目录（不带 resumes/ data/ 用户数据、历史版本、导出文件）
const skip = (p) => /(^|[\\/])\.history([\\/]|$)/.test(p) || /[\\/]data[\\/]config\.json$/.test(p) || /\.(tmp|part)$/.test(p);
for (const dir of ['template', 'public', 'assets', 'starter', 'examples']) {
  const src = path.join(root, dir);
  if (fs.existsSync(src)) fs.cpSync(src, path.join(outDir, dir), { recursive: true, filter: (p) => !skip(p) });
}
for (const f of ['LICENSE', 'README.md']) fs.copyFileSync(path.join(root, f), path.join(outDir, f));
fs.rmSync(work, { recursive: true, force: true });
console.log('\n已生成：' + path.relative(root, outDir) + path.sep + exeName);
