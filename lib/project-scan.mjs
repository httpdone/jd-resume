// 本机项目扫描：读取用户指定的项目目录，整理成「可交给 Agent 的事实材料」，用于生成经历素材。
// 原则：只读不写；跳过依赖 / 构建产物 / 二进制；绝不读取密钥类文件；发送前再做一遍密钥脱敏；总量有上限。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';

export const LIMITS = {
  maxFiles: 5000,        // 最多遍历的文件数
  maxDepth: 12,          // 最大遍历深度
  treeDepth: 3,          // 目录树展示深度
  treeEntries: 220,      // 目录树最多条目
  budget: 60000,         // 发给模型的总字符上限
  perFile: 6000,         // 单个文件最多字符
  locFileBytes: 512 * 1024, // 超过这个大小的源码文件不统计行数
  locTotalBytes: 40 * 1024 * 1024,
  samples: 8,            // 抽样源码文件数
  gitTimeout: 8000,
  totalTimeout: 25000,
};

// 一律跳过的目录
const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'out', 'target', '.venv', 'venv', 'env', '__pycache__',
  '.next', '.nuxt', '.svelte-kit', '.turbo', '.cache', '.parcel-cache', '.idea', '.vscode', '.vs', 'vendor', 'coverage',
  '.pytest_cache', '.mypy_cache', '.tox', '.gradle', 'bin', 'obj', 'Library', 'Temp', 'Logs', 'UserSettings', 'Pods',
  'DerivedData', '.dart_tool', '.history', '.unipi', 'bower_components', 'jspm_packages', '.terraform', '.serverless',
  'site-packages', 'tmp', '.tmp', '.DS_Store',
]);

// 二进制 / 媒体 / 字体 / 压缩包等：只计数，不读取
const BINARY_EXT = new Set(('png jpg jpeg gif webp bmp ico icns tif tiff psd ai sketch fig svgz heic avif mp3 mp4 wav ogg flac aac m4a mov avi mkv webm '
  + 'ttf otf woff woff2 eot zip tar gz tgz bz2 xz 7z rar jar war ear apk ipa aab dmg iso exe dll so dylib a lib o obj class pyc pyo pyd '
  + 'wasm bin dat db sqlite sqlite3 mdb pdf doc docx xls xlsx ppt pptx key numbers pages unitypackage asset prefab mat fbx blend '
  + 'meta map node lockb').split(/\s+/));

// 锁文件：不读内容，只用文件名判断包管理器
const LOCK_FILES = {
  'package-lock.json': 'npm', 'yarn.lock': 'Yarn', 'pnpm-lock.yaml': 'pnpm', 'bun.lockb': 'Bun', 'bun.lock': 'Bun',
  'poetry.lock': 'Poetry', 'uv.lock': 'uv', 'Pipfile.lock': 'Pipenv', 'Cargo.lock': 'Cargo', 'go.sum': 'Go Modules',
  'composer.lock': 'Composer', 'Gemfile.lock': 'Bundler', 'Podfile.lock': 'CocoaPods', 'pubspec.lock': 'Dart pub',
  'gradle.lockfile': 'Gradle', 'packages.lock.json': 'NuGet', 'mix.lock': 'Mix',
};

// 密钥类文件：绝不读取（连抽样也不会）
const SECRET_FILE_RES = [
  /^\.env($|\.)/i, /^\.envrc$/i, /\.env$/i, /\.(pem|key|p12|pfx|jks|keystore|crt|cer|der|asc|gpg|ovpn|kdbx|tfvars|tfstate)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)/i, /^credentials/i, /secret/i, /^\.npmrc$/i, /^\.pypirc$/i, /^\.netrc$/i, /^\.git-credentials$/i,
  /^\.htpasswd$/i, /^\.dockercfg$/i, /service[-_]?account.*\.json$/i, /^local\.settings\.json$/i, /^appsettings\.(development|production|local)\.json$/i,
  /^\.?aws$/i, /^known_hosts$/i, /^authorized_keys$/i, /password/i, /^private/i, /\.sqlite\b/i,
];

const LANG_BY_EXT = {
  js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', jsx: 'JavaScript', ts: 'TypeScript', tsx: 'TypeScript', mts: 'TypeScript', cts: 'TypeScript',
  vue: 'Vue', svelte: 'Svelte', py: 'Python', ipynb: 'Jupyter', java: 'Java', kt: 'Kotlin', kts: 'Kotlin', scala: 'Scala', groovy: 'Groovy',
  go: 'Go', rs: 'Rust', c: 'C', h: 'C/C++ 头文件', cc: 'C++', cpp: 'C++', cxx: 'C++', hpp: 'C++', cs: 'C#', fs: 'F#', swift: 'Swift',
  m: 'Objective-C', mm: 'Objective-C', php: 'PHP', rb: 'Ruby', dart: 'Dart', lua: 'Lua', r: 'R', jl: 'Julia', ex: 'Elixir', exs: 'Elixir',
  erl: 'Erlang', hs: 'Haskell', clj: 'Clojure', sol: 'Solidity', sh: 'Shell', bash: 'Shell', zsh: 'Shell', ps1: 'PowerShell', bat: 'Batch',
  sql: 'SQL', html: 'HTML', htm: 'HTML', css: 'CSS', scss: 'SCSS', sass: 'SCSS', less: 'Less', proto: 'Protobuf', graphql: 'GraphQL', gql: 'GraphQL',
  shader: 'Shader', hlsl: 'Shader', glsl: 'Shader', cu: 'CUDA', v: 'Verilog', sv: 'SystemVerilog', vhd: 'VHDL', wxml: '小程序', wxss: '小程序',
};
// 只有这些算「源码」（参与行数统计、接口计数、抽样）；HTML/CSS 计行数但不抽样
const SAMPLE_EXT = new Set(['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'vue', 'svelte', 'py', 'java', 'kt', 'scala', 'go', 'rs', 'c', 'cc', 'cpp', 'cxx', 'hpp', 'h', 'cs', 'swift', 'm', 'mm', 'php', 'rb', 'dart', 'lua', 'ex', 'sol', 'cu']);

const MANIFEST_NAMES = new Set([
  'package.json', 'pyproject.toml', 'requirements.txt', 'requirements-dev.txt', 'setup.py', 'setup.cfg', 'Pipfile', 'environment.yml',
  'go.mod', 'Cargo.toml', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts', 'composer.json',
  'Gemfile', 'pubspec.yaml', 'Package.swift', 'Podfile', 'CMakeLists.txt', 'Makefile', 'Dockerfile', 'mix.exs', 'deno.json',
  'tsconfig.json', 'vite.config.ts', 'vite.config.js', 'next.config.js', 'next.config.mjs', 'nuxt.config.ts', 'angular.json',
  'app.json', 'project.config.json', 'manifest.json', 'ProjectVersion.txt', 'serverless.yml', 'Chart.yaml', 'wrangler.toml', 'vercel.json',
]);
const MANIFEST_RES = [/\.csproj$/i, /\.sln$/i, /\.fsproj$/i, /\.vcxproj$/i, /^docker-compose.*\.ya?ml$/i, /^compose\.ya?ml$/i, /^Dockerfile\./i, /\.uproject$/i, /\.gemspec$/i];

const ENTRY_RES = [
  /^(src\/|app\/|cmd\/[^/]+\/|server\/|backend\/)?(main|index|app|server|cli|application)\.(m?[jt]sx?|py|go|rs|java|kt|cs|php|rb|dart)$/i,
  /(^|\/)(manage|wsgi|asgi)\.py$/i, /(^|\/)Program\.cs$/, /(^|\/)[A-Z]\w*Application\.(java|kt)$/, /(^|\/)lib\/main\.dart$/,
  /(^|\/)(routes?|router|urls|api)\.(m?[jt]s|py|go|php|rb)$/i,
];

const ROUTE_RES = [
  /\b(?:app|router|server|api|route|r|e|g|v\d)\.(?:get|post|put|patch|delete|all)\s*\(\s*['"`]/g,      // Express/Koa/Fastify/Hono/Gin（小写）
  /@(?:app|router|bp|blueprint|api|\w+_router)\.(?:get|post|put|patch|delete|route|api_route|websocket)\s*\(/g, // FastAPI/Flask
  /@(?:Get|Post|Put|Patch|Delete|Request)Mapping\b/g,                                                 // Spring
  /\.(?:GET|POST|PUT|PATCH|DELETE|Handle|HandleFunc)\s*\(\s*"/g,                                      // Go gin/net/http
  /@(?:Get|Post|Put|Patch|Delete|All)\s*\(\s*['"`)]/g,                                                 // NestJS
  /\b(?:path|re_path)\s*\(\s*r?['"]/g,                                                                 // Django urls
  /Route::(?:get|post|put|patch|delete|any)\s*\(/g,                                                    // Laravel
  /\[Http(?:Get|Post|Put|Patch|Delete)\b/g,                                                            // ASP.NET
];

// ---------- 密钥脱敏 ----------
const REDACT_RES = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[已隐藏：私钥]'],
  [/\bsk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_\-]{8,}/g, '[已隐藏：密钥]'],
  [/\b(?:ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{20,}\b/g, '[已隐藏：令牌]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[已隐藏：令牌]'],
  [/\bglpat-[A-Za-z0-9_\-]{16,}\b/g, '[已隐藏：令牌]'],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '[已隐藏：密钥]'],
  [/\bAIza[0-9A-Za-z_\-]{30,}\b/g, '[已隐藏：密钥]'],
  [/\bxox[abprs]-[A-Za-z0-9\-]{10,}\b/g, '[已隐藏：令牌]'],
  [/\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{10,}\b/g, '[已隐藏：密钥]'],
  [/\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b/g, '[已隐藏：令牌]'],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/\-]{16,}=*/gi, '$1 [已隐藏]'],
  [/(\b[a-z][a-z0-9+.\-]*:\/\/[^\s:\/@'"]+:)[^\s@'"\/]+(@)/gi, '$1[已隐藏]$2'], // 连接串里的密码
  // key=xxx / "token": "xxx" / PASSWORD: xxx 等赋值
  [/((?:api[_-]?key|apikey|access[_-]?key|secret[_-]?key|client[_-]?secret|secret|token|access[_-]?token|refresh[_-]?token|auth[_-]?token|password|passwd|pwd|private[_-]?key|credential)s?["']?\s*[:=]\s*["']?)([^\s"'`,;)}]{6,})/gi, '$1[已隐藏]'],
  [/\b[a-f0-9]{40,}\b/gi, '[已隐藏：长十六进制串]'],
];
export function redactSecrets(text) {
  let out = String(text || '');
  let hits = 0;
  for (const [re, rep] of REDACT_RES) out = out.replace(re, (...m) => { hits++; return typeof rep === 'string' ? rep.replace(/\$(\d)/g, (_, i) => m[+i] ?? '') : rep; });
  return { text: out, hits };
}

export function isSecretFile(name) { return SECRET_FILE_RES.some((re) => re.test(name)); }

// ---------- 工具 ----------
function run(cmd, args, cwd, timeout = LIMITS.gitTimeout) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C.UTF-8' } }, (err, stdout) => {
      resolve(err ? null : String(stdout || ''));
    });
  });
}
const extOf = (name) => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(i + 1).toLowerCase() : ''; };
const toPosix = (p) => p.split(path.sep).join('/');
function readText(abs, max) {
  try {
    const fd = fs.openSync(abs, 'r');
    try {
      const buf = Buffer.alloc(Math.min(max * 3 + 16, 4 * 1024 * 1024));
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      const slice = buf.subarray(0, n);
      if (slice.includes(0)) return null; // 二进制
      return slice.toString('utf8');
    } finally { fs.closeSync(fd); }
  } catch { return null; }
}
function clipText(t, n) { const s = String(t || ''); return s.length > n ? s.slice(0, n - 40) + '\n…（已截断，原文 ' + s.length + ' 字符）' : s; }

/** 校验并解析用户给的项目路径 */
export function resolveProjectDir(input) {
  let raw = String(input || '').trim().replace(/^["']|["']$/g, '');
  if (!raw) throw Object.assign(new Error('请填写项目目录的完整路径'), { status: 400 });
  if (raw === '~' || raw.startsWith('~/') || raw.startsWith('~\\')) raw = path.join(os.homedir(), raw.slice(1));
  if (!path.isAbsolute(raw)) throw Object.assign(new Error('请填写绝对路径，例如 E:\\Project\\demo 或 /Users/me/code/demo'), { status: 400 });
  const abs = path.resolve(raw);
  let st;
  try { st = fs.statSync(abs); } catch { throw Object.assign(new Error('目录不存在：' + abs), { status: 400 }); }
  if (!st.isDirectory()) throw Object.assign(new Error('这不是一个目录：' + abs), { status: 400 });
  let real = abs;
  try { real = fs.realpathSync(abs); } catch { /* 忽略 */ }
  const same = (a, b) => (process.platform === 'win32' || process.platform === 'darwin') ? a.toLowerCase() === b.toLowerCase() : a === b;
  const strip = (p) => p.replace(/[\\/]+$/, '') || p;
  if (same(strip(real), strip(path.parse(real).root)) || real === path.parse(real).root) throw Object.assign(new Error('不能扫描磁盘根目录，请选具体的项目文件夹'), { status: 400 });
  const home = os.homedir();
  if (same(strip(real), strip(home))) throw Object.assign(new Error('不能扫描整个用户主目录，请选具体的项目文件夹'), { status: 400 });
  return real;
}

// 递归遍历（不跟随符号链接）
function walk(root, deadline) {
  const files = [];
  const dirs = [];
  let truncated = false;
  const skippedSecrets = [];
  const stack = [{ rel: '', depth: 0 }];
  while (stack.length) {
    const { rel, depth } = stack.pop();
    let entries;
    try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { continue; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const d of entries) {
      if (Date.now() > deadline) { truncated = true; break; }
      const r = rel ? rel + '/' + d.name : d.name;
      if (d.isSymbolicLink()) continue;
      if (d.isDirectory()) {
        if (IGNORE_DIRS.has(d.name) || (d.name.startsWith('.') && d.name !== '.github')) continue;
        if (isSecretFile(d.name)) { skippedSecrets.push(r + '/'); continue; }
        dirs.push(r);
        if (depth + 1 < LIMITS.maxDepth) stack.push({ rel: r, depth: depth + 1 });
      } else if (d.isFile()) {
        if (files.length >= LIMITS.maxFiles) { truncated = true; break; }
        files.push(r);
      }
    }
    if (truncated) break;
  }
  return { files, dirs, truncated, skippedSecrets };
}

// 在 git 仓库里优先用 git ls-files（自动遵守 .gitignore）
async function gitFiles(root) {
  const out = await run('git', ['ls-files', '-co', '--exclude-standard', '-z'], root);
  if (out == null) return null;
  return out.split('\0').filter(Boolean);
}

function filterList(list) {
  const files = [];
  const dirs = new Set();
  const skippedSecrets = [];
  let truncated = false;
  for (const r of list) {
    const parts = r.split('/');
    const name = parts[parts.length - 1];
    if (parts.slice(0, -1).some((p) => IGNORE_DIRS.has(p) || (p.startsWith('.') && p !== '.github'))) continue;
    if (parts.slice(0, -1).some((p) => isSecretFile(p))) { skippedSecrets.push(r); continue; }
    if (parts.length - 1 > LIMITS.maxDepth) continue;
    if (files.length >= LIMITS.maxFiles) { truncated = true; break; }
    files.push(r);
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
  }
  return { files, dirs: [...dirs], truncated, skippedSecrets };
}

function buildTree(files, dirs) {
  const lines = [];
  const children = new Map();
  const add = (parent, child, isDir) => { if (!children.has(parent)) children.set(parent, new Map()); children.get(parent).set(child, isDir || children.get(parent).get(child) || false); };
  for (const d of dirs) { const i = d.lastIndexOf('/'); add(i < 0 ? '' : d.slice(0, i), d, true); }
  for (const f of files) { const i = f.lastIndexOf('/'); add(i < 0 ? '' : f.slice(0, i), f, false); }
  const count = (dir) => files.filter((f) => f.startsWith(dir + '/')).length;
  let truncated = false;
  const visit = (dir, depth) => {
    const kids = [...(children.get(dir) || new Map()).entries()].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]));
    let shownFiles = 0;
    for (const [p, isDir] of kids) {
      if (lines.length >= LIMITS.treeEntries) { truncated = true; return; }
      const name = p.slice(p.lastIndexOf('/') + 1);
      if (isDir) {
        lines.push('  '.repeat(depth) + name + '/  (' + count(p) + ' 个文件)');
        if (depth + 1 < LIMITS.treeDepth) visit(p, depth + 1);
      } else {
        if (shownFiles >= 15) { lines.push('  '.repeat(depth) + '…（还有 ' + kids.filter((k) => !k[1]).length + ' 个文件中的其余部分）'); break; }
        if (isSecretFile(name)) continue; // 连文件名都不出现在目录树里
        lines.push('  '.repeat(depth) + name);
        shownFiles++;
      }
    }
  };
  visit('', 0);
  return { text: lines.join('\n'), truncated };
}

function detectStack(manifests, files, langs) {
  const found = new Set();
  const text = manifests.map((m) => m.raw).join('\n').toLowerCase();
  const KNOWN = {
    react: 'React', 'react-native': 'React Native', vue: 'Vue', next: 'Next.js', nuxt: 'Nuxt', svelte: 'Svelte', angular: 'Angular', '@angular/core': 'Angular',
    express: 'Express', koa: 'Koa', fastify: 'Fastify', '@nestjs/core': 'NestJS', hono: 'Hono', electron: 'Electron', vite: 'Vite', webpack: 'webpack', tailwindcss: 'Tailwind CSS',
    typescript: 'TypeScript', prisma: 'Prisma', mongoose: 'MongoDB', redis: 'Redis', ioredis: 'Redis', mysql: 'MySQL', mysql2: 'MySQL', pg: 'PostgreSQL', sequelize: 'Sequelize', typeorm: 'TypeORM',
    'socket.io': 'Socket.IO', antd: 'Ant Design', 'element-plus': 'Element Plus', echarts: 'ECharts', three: 'Three.js', jest: 'Jest', vitest: 'Vitest', playwright: 'Playwright', puppeteer: 'Puppeteer',
    fastapi: 'FastAPI', flask: 'Flask', django: 'Django', torch: 'PyTorch', pytorch: 'PyTorch', tensorflow: 'TensorFlow', transformers: 'Transformers', langchain: 'LangChain', llama_index: 'LlamaIndex',
    numpy: 'NumPy', pandas: 'pandas', 'scikit-learn': 'scikit-learn', opencv: 'OpenCV', sqlalchemy: 'SQLAlchemy', celery: 'Celery', pydantic: 'Pydantic', uvicorn: 'Uvicorn', streamlit: 'Streamlit', gradio: 'Gradio',
    'spring-boot': 'Spring Boot', mybatis: 'MyBatis', 'gin-gonic/gin': 'Gin', 'gorm.io': 'GORM', 'labstack/echo': 'Echo', tokio: 'Tokio', actix: 'Actix', axum: 'Axum', serde: 'Serde',
    'laravel/framework': 'Laravel', rails: 'Rails', flutter: 'Flutter', kafka: 'Kafka', rabbitmq: 'RabbitMQ', elasticsearch: 'Elasticsearch', grpc: 'gRPC', graphql: 'GraphQL', unity: 'Unity',
  };
  for (const [k, v] of Object.entries(KNOWN)) {
    const re = new RegExp('(^|[\\s"\'/:=<>,\\[(])' + k.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '($|[\\s"\'/:=<>,\\]@~^)\\-_.0-9])', 'm');
    if (re.test(text)) found.add(v);
  }
  for (const f of files) {
    const name = f.slice(f.lastIndexOf('/') + 1);
    if (LOCK_FILES[name]) found.add(LOCK_FILES[name]);
    if (/^Dockerfile/i.test(name) || /docker-compose/i.test(name)) found.add('Docker');
    if (f.startsWith('.github/workflows/')) found.add('GitHub Actions');
    if (/ProjectSettings\/ProjectVersion\.txt$/.test(f)) found.add('Unity');
    if (/\.uproject$/.test(name)) found.add('Unreal Engine');
  }
  for (const l of langs.slice(0, 6)) if (l.files >= 2 || l.loc > 200) found.add(l.lang);
  return [...found];
}

async function gitStats(root, author) {
  const inside = await run('git', ['rev-parse', '--is-inside-work-tree'], root);
  if (!inside || inside.trim() !== 'true') return null;
  const hasHead = await run('git', ['rev-parse', '--verify', 'HEAD'], root);
  if (!hasHead) return { repo: true, commits: 0 };
  let name = String(author?.name || '').trim();
  let email = String(author?.email || '').trim();
  let auto = false;
  if (!name && !email) {
    name = (await run('git', ['config', 'user.name'], root) || '').trim();
    email = (await run('git', ['config', 'user.email'], root) || '').trim();
    auto = Boolean(name || email);
  }
  const authorArgs = [...(name ? ['--author=' + name] : []), ...(email ? ['--author=' + email] : [])];
  const filt = authorArgs.length ? ['--fixed-strings', '--regexp-ignore-case', ...authorArgs] : [];
  const [total, first, last, shortlog] = await Promise.all([
    run('git', ['rev-list', '--count', 'HEAD'], root),
    run('git', ['log', '--reverse', '--format=%ad', '--date=short', 'HEAD'], root),
    run('git', ['log', '-1', '--format=%ad', '--date=short', 'HEAD'], root),
    run('git', ['shortlog', '-sn', '--no-merges', 'HEAD'], root),
  ]);
  const mineDates = filt.length ? await run('git', ['log', ...filt, '--format=%ad', '--date=short', 'HEAD'], root) : null;
  const mineList = mineDates ? mineDates.split('\n').filter(Boolean) : [];
  const nameLog = await run('git', ['log', ...filt, '--no-merges', '--name-only', '--format=', '-n', '2000', 'HEAD'], root) || '';
  const dirCount = new Map();
  const fileCount = new Map();
  for (const f of nameLog.split('\n').map((x) => x.trim()).filter(Boolean)) {
    const parts = f.split('/');
    if (parts.some((p) => IGNORE_DIRS.has(p)) || isSecretFile(parts[parts.length - 1])) continue;
    const d = parts.length > 2 ? parts.slice(0, 2).join('/') : parts.length === 2 ? parts[0] : '（根目录）';
    dirCount.set(d, (dirCount.get(d) || 0) + 1);
    fileCount.set(f, (fileCount.get(f) || 0) + 1);
  }
  const subjects = await run('git', ['log', ...filt, '--no-merges', '-n', '50', '--format=%ad %s', '--date=short', 'HEAD'], root) || '';
  const firstDate = (first || '').split('\n').find(Boolean) || '';
  return {
    repo: true,
    commits: Number((total || '').trim()) || 0,
    first: firstDate,
    last: (last || '').trim(),
    contributors: (shortlog || '').split('\n').filter(Boolean).length,
    author: { name, email, auto, commits: filt.length ? mineList.length : null, first: mineList[mineList.length - 1] || '', last: mineList[0] || '' },
    topDirs: [...dirCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([dir, changes]) => ({ dir, changes })),
    topFiles: [...fileCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([file, changes]) => ({ file, changes })),
    subjects: subjects.split('\n').filter(Boolean).slice(0, 50),
  };
}

// ---------- 主流程 ----------
export async function scanProject({ path: input, author = {} } = {}) {
  const root = resolveProjectDir(input);
  const started = Date.now();
  const deadline = started + LIMITS.totalTimeout;
  const listed = await gitFiles(root);
  const base = listed ? filterList(listed) : walk(root, deadline);
  const { files, dirs } = base;
  const skippedSecrets = [...base.skippedSecrets];

  // 分类
  const langMap = new Map();
  const readable = [];
  let binaryCount = 0;
  const lockNames = [];
  let locBytes = 0;
  const routeHits = { total: 0, files: new Map() };
  const sizes = new Map();
  for (const rel of files) {
    if (Date.now() > deadline) break;
    const name = rel.slice(rel.lastIndexOf('/') + 1);
    if (isSecretFile(name)) { skippedSecrets.push(rel); continue; }
    if (LOCK_FILES[name]) { lockNames.push(rel); continue; }
    const ext = extOf(name);
    if (BINARY_EXT.has(ext)) { binaryCount++; continue; }
    if (/\.min\.(js|css)$/i.test(name)) continue;
    const lang = LANG_BY_EXT[ext];
    if (!lang) { readable.push(rel); continue; }
    const abs = path.join(root, rel);
    let size = 0;
    try { size = fs.statSync(abs).size; } catch { continue; }
    sizes.set(rel, size);
    const stat = langMap.get(lang) || { lang, files: 0, loc: 0 };
    stat.files++;
    if (size <= LIMITS.locFileBytes && locBytes + size <= LIMITS.locTotalBytes) {
      const txt = readText(abs, size + 1);
      if (txt != null) {
        locBytes += size;
        stat.loc += txt.split('\n').filter((l) => l.trim()).length;
        if (SAMPLE_EXT.has(ext)) {
          let n = 0;
          for (const re of ROUTE_RES) { re.lastIndex = 0; n += (txt.match(re) || []).length; }
          if (n) { routeHits.total += n; routeHits.files.set(rel, n); }
        }
      }
    }
    langMap.set(lang, stat);
    readable.push(rel);
  }
  const langs = [...langMap.values()].sort((a, b) => b.loc - a.loc || b.files - a.files);

  // 清单 / README
  const manifests = [];
  for (const rel of files) {
    const name = rel.slice(rel.lastIndexOf('/') + 1);
    const depth = rel.split('/').length - 1;
    const isManifest = MANIFEST_NAMES.has(name) || MANIFEST_RES.some((re) => re.test(name)) || /(^|\/)Packages\/manifest\.json$/.test(rel);
    if (!isManifest || depth > 2 || isSecretFile(name)) continue;
    if (name === 'manifest.json' && !/Packages\/manifest\.json$/.test(rel) && depth > 0) continue;
    const raw = readText(path.join(root, rel), LIMITS.perFile);
    if (raw == null) continue;
    manifests.push({ rel, raw });
    if (manifests.length >= 14) break;
  }
  const readmes = files.filter((rel) => /^readme(\.[a-z]+)?$/i.test(rel.slice(rel.lastIndexOf('/') + 1)) && rel.split('/').length <= 2)
    .sort((a, b) => a.split('/').length - b.split('/').length).slice(0, 3);

  const git = await gitStats(root, author);
  const stack = detectStack(manifests, files, langs);

  // 顶层模块：含源码的一级目录
  const topModules = [...new Set(readable.filter((r) => r.includes('/') && LANG_BY_EXT[extOf(r)]).map((r) => r.split('/')[0]))];

  // 抽样源码：入口 → 我改得最多的 → 最大的
  const isSample = (r) => SAMPLE_EXT.has(extOf(r)) && sizes.has(r) && !/(^|\/)(tests?|__tests__|spec|examples?|fixtures?|mocks?)\//i.test(r) && !/\.(test|spec)\./i.test(r);
  const picks = [];
  const pick = (r, why) => { if (picks.length < LIMITS.samples && isSample(r) && !picks.some((p) => p.rel === r)) picks.push({ rel: r, why }); };
  files.filter((r) => ENTRY_RES.some((re) => re.test(r))).sort((a, b) => a.split('/').length - b.split('/').length).slice(0, 3).forEach((r) => pick(r, '入口 / 路由'));
  (git?.topFiles || []).forEach((f) => { if (picks.length < 6) pick(f.file, '提交中改动最多（' + f.changes + ' 次）'); });
  [...routeHits.files.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).forEach(([r, n]) => pick(r, '接口定义较多（约 ' + n + ' 处）'));
  [...sizes.entries()].filter(([r]) => isSample(r)).sort((a, b) => b[1] - a[1]).forEach(([r]) => pick(r, '体量最大的源码之一'));

  // ---------- 组装发给模型的材料（按优先级装入预算） ----------
  const sent = [];
  let budget = LIMITS.budget;
  let redactions = 0;
  const parts = [];
  const push = (title, body, meta) => {
    if (budget <= 200) return false;
    const r = redactSecrets(body);
    redactions += r.hits;
    const head = '\n=== ' + title + ' ===\n';
    let text = r.text;
    const room = budget - head.length;
    if (text.length > room) text = text.slice(0, room) + '\n…（预算用尽，已截断）';
    parts.push(head + text);
    budget -= head.length + text.length;
    if (meta) sent.push({ ...meta, chars: text.length });
    return true;
  };

  const projectName = (() => {
    const pkg = manifests.find((m) => m.rel === 'package.json');
    try { const n = pkg && JSON.parse(pkg.raw).name; if (n) return String(n); } catch { /* 忽略 */ }
    return path.basename(root);
  })();

  const facts = {
    项目名: projectName,
    目录名: path.basename(root),
    扫描到的文件数: files.length + (base.truncated ? '+（达到上限 ' + LIMITS.maxFiles + '，已截断）' : ''),
    源码语言统计: langs.slice(0, 12).map((l) => l.lang + '：' + l.files + ' 个文件 / ' + l.loc + ' 行（非空行）').join('；'),
    识别到的技术: stack.join('、'),
    包管理锁文件: lockNames.map((r) => r.slice(r.lastIndexOf('/') + 1)).join('、') || '无',
    二进制或媒体文件数: binaryCount,
    顶层源码模块: topModules.slice(0, 30).join('、') + (topModules.length > 30 ? ' 等 ' + topModules.length + ' 个' : ''),
    接口路由定义粗略计数: routeHits.total ? '约 ' + routeHits.total + ' 处（正则粗略统计，分布在 ' + routeHits.files.size + ' 个文件，可能有误差）' : '未识别到',
  };
  if (git && git.commits) {
    facts.Git = '总提交 ' + git.commits + ' 次，参与者 ' + git.contributors + ' 人，时间跨度 ' + git.first + ' ~ ' + git.last;
    if (git.author.commits != null) facts['本人提交（按作者筛选：' + [git.author.name, git.author.email].filter(Boolean).join(' / ') + '）'] = git.author.commits + ' 次' + (git.author.commits ? '，' + git.author.first + ' ~ ' + git.author.last : '');
    if (git.topDirs.length) facts[(git.author.commits != null ? '本人' : '全部') + '改动最多的目录'] = git.topDirs.map((d) => d.dir + '（' + d.changes + '）').join('、');
  } else facts.Git = git ? '是 Git 仓库，但还没有提交' : '不是 Git 仓库或本机没有安装 git';

  push('可统计事实（由程序计算，可以直接引用）', Object.entries(facts).map(([k, v]) => k + '：' + v).join('\n'), { file: '（统计结果）', kind: '统计' });
  const tree = buildTree(readable.concat(lockNames), dirs);
  push('目录结构（前 ' + LIMITS.treeDepth + ' 层，已排除依赖、构建产物和密钥文件）', tree.text + (tree.truncated ? '\n…（目录过多，已截断）' : ''), { file: '（目录树）', kind: '目录' });
  for (const rel of readmes) {
    const t = readText(path.join(root, rel), LIMITS.perFile);
    if (t != null) push('说明文档 ' + rel, clipText(t, LIMITS.perFile), { file: rel, kind: 'README' });
  }
  for (const m of manifests) push('依赖 / 配置清单 ' + m.rel, clipText(m.raw, Math.min(LIMITS.perFile, 3000)), { file: m.rel, kind: '清单' });
  if (git?.subjects?.length) push('最近提交记录' + (git.author.commits != null ? '（仅本人）' : '') + '，共 ' + git.subjects.length + ' 条', git.subjects.join('\n'), { file: '（git log）', kind: 'Git' });
  for (const p of picks) {
    const t = readText(path.join(root, p.rel), LIMITS.perFile);
    if (t != null && !push('源码抽样 ' + p.rel + '（' + p.why + '）', clipText(t, LIMITS.perFile), { file: p.rel, kind: '源码' })) break;
  }

  const payload = '【本机项目扫描材料】项目目录名：' + path.basename(root) + parts.join('\n');
  const summary = {
    root, name: projectName, stack, langs: langs.slice(0, 10),
    fileCount: files.length, walkTruncated: base.truncated, binaryCount, usedGitIgnore: Boolean(listed),
    routes: routeHits.total, modules: topModules.slice(0, 30),
    git: git ? { commits: git.commits || 0, first: git.first || '', last: git.last || '', contributors: git.contributors || 0, author: git.author || null, topDirs: (git.topDirs || []).slice(0, 6) } : null,
    sent, totalChars: payload.length, budget: LIMITS.budget, redactions,
    skippedSecrets: [...new Set(skippedSecrets)].slice(0, 30), skippedSecretsCount: new Set(skippedSecrets).size,
    ms: Date.now() - started,
  };
  return remember({ summary, payload });
}

// 扫描结果只在内存里保留 30 分钟，生成时凭 scanId 取回，避免把材料在浏览器和服务之间来回传
const CACHE = new Map();
function remember(scan) {
  const now = Date.now();
  for (const [k, v] of CACHE) if (now - v.at > 30 * 60 * 1000) CACHE.delete(k);
  while (CACHE.size >= 10) CACHE.delete(CACHE.keys().next().value);
  const scanId = crypto.randomBytes(8).toString('hex');
  CACHE.set(scanId, { ...scan, at: now });
  return { scanId, ...scan };
}
export function getScan(id) {
  const hit = CACHE.get(String(id || ''));
  if (!hit) throw Object.assign(new Error('扫描结果已过期（服务重启或超过 30 分钟），请重新扫描'), { status: 400 });
  return hit;
}
