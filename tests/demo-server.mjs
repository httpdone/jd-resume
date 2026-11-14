// 用示例数据启动一个临时工作台（截图、演示用），不会碰你自己的数据目录。
// 用法：node tests/demo-server.mjs [端口，默认 4321]   然后再运行 tests/screenshots*.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-demo-'));
fs.cpSync(path.join(ROOT, 'examples'), HOME, { recursive: true });
fs.writeFileSync(path.join(HOME, 'data', '.initialized'), new Date().toISOString() + '\n');
console.log('示例数据目录（临时）：' + HOME);
const port = process.argv[2] || '4321';
const child = spawn(process.execPath, ['cli.mjs', 'serve', '--port', port, '--no-open'], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, RESUME_HOME: HOME } });
const stop = () => { child.kill(); fs.rmSync(HOME, { recursive: true, force: true }); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
child.on('exit', (code) => { fs.rmSync(HOME, { recursive: true, force: true }); process.exit(code || 0); });
