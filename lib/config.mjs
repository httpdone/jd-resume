import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 打包成单文件可执行程序（Node SEA）时，程序目录就是可执行文件所在目录；
// 源码运行时是仓库根目录。程序目录只放程序本身（template/ public/ assets/ starter/ examples/），
// 更新时整个替换即可；用户数据放在下面的 HOME 里。
function isSea() {
  try { return Boolean(process.getBuiltinModule?.('node:sea')?.isSea?.()); } catch { return false; }
}
export const IS_SEA = isSea();
export const ROOT = process.env.RESUME_APP_ROOT
  ? path.resolve(process.env.RESUME_APP_ROOT)
  : IS_SEA ? path.dirname(process.execPath) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TEMPLATE_DIR = path.join(ROOT, 'template');
export const ASSETS_DIR = path.join(ROOT, 'assets');
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const STARTER_DIR = path.join(ROOT, 'starter');
export const EXAMPLES_DIR = path.join(ROOT, 'examples');

/** 系统用户数据目录：Windows %APPDATA%\jd-resume，macOS ~/Library/Application Support/jd-resume，Linux $XDG_DATA_HOME/jd-resume 或 ~/.local/share/jd-resume */
export function userDataDir(env = process.env, platform = process.platform, home = os.homedir()) {
  if (platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'jd-resume');
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'jd-resume');
  return path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'jd-resume');
}

/** 旧版（4.7 及以前）把数据放在程序目录里：程序目录下已有简历或配置时继续沿用，老用户不用迁移 */
export function hasLegacyData(root) {
  try {
    if (fs.existsSync(path.join(root, 'data', 'config.json'))) return true;
    const dir = path.join(root, 'resumes');
    return fs.readdirSync(dir, { withFileTypes: true })
      .some((d) => d.isDirectory() && !d.name.startsWith('.') && fs.existsSync(path.join(dir, d.name, 'body.html')));
  } catch { return false; }
}

// 数据目录（HOME）优先级：环境变量 RESUME_HOME → 程序目录里的旧数据 → 系统用户数据目录
function resolveHome() {
  if (process.env.RESUME_HOME) return { home: path.resolve(process.env.RESUME_HOME), mode: 'env' };
  if (hasLegacyData(ROOT)) return { home: ROOT, mode: 'portable' };
  return { home: userDataDir(), mode: 'user' };
}
const resolved = resolveHome();
export const HOME = resolved.home;
/** env：RESUME_HOME 指定；portable：沿用程序目录里的旧数据；user：系统用户数据目录 */
export const HOME_MODE = resolved.mode;
export const RESUMES_DIR = path.join(HOME, 'resumes');
export const OUT_DIR = path.join(HOME, 'out');
export const DATA_DIR = path.join(HOME, 'data');
