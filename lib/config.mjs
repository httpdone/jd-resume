import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 打包成单文件可执行程序（Node SEA）时，程序目录就是可执行文件所在目录；
// 源码运行时是仓库根目录。
function isSea() {
  try { return Boolean(process.getBuiltinModule?.('node:sea')?.isSea?.()); } catch { return false; }
}
export const IS_SEA = isSea();
export const ROOT = process.env.RESUME_APP_ROOT
  ? path.resolve(process.env.RESUME_APP_ROOT)
  : IS_SEA ? path.dirname(process.execPath) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TEMPLATE_DIR = path.join(ROOT, 'template');
export const ASSETS_DIR = path.join(ROOT, 'assets');
// RESUME_HOME：把简历 / 数据 / 导出目录放到别处（测试用，或想把数据放进网盘同步目录时用）
const HOME = process.env.RESUME_HOME ? path.resolve(process.env.RESUME_HOME) : ROOT;
export const RESUMES_DIR = path.join(HOME, 'resumes');
export const OUT_DIR = path.join(HOME, 'out');
export const DATA_DIR = path.join(HOME, 'data');
export const PUBLIC_DIR = path.join(ROOT, 'public');
