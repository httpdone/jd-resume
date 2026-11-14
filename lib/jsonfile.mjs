import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const newId = () => crypto.randomBytes(6).toString('hex');
export const nowIso = () => new Date().toISOString();

export function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}
