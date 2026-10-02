import { realpath } from 'node:fs/promises';
import pathApi, { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export function isAbsoluteStatePath(value, paths = pathApi) {
  if (typeof value !== 'string' || !paths.isAbsolute(value)) return false;
  if (paths.sep !== '\\') return true;
  // A leading separator alone is relative to the current Windows drive.
  // Device namespaces are not private data folders either.
  return /^[A-Za-z]:[\\/]/.test(value) ||
    /^[\\/]{2}(?![?.](?:[\\/]|$))[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/.test(value);
}
export class PluginStateError extends Error {}

async function resolvedLocation(path) {
  const suffix = [];
  for (;;) {
    try { return join(await realpath(path), ...suffix); }
    catch (error) {
      if (error.code !== 'ENOENT' || dirname(path) === path) throw error;
      suffix.unshift(basename(path));
      path = dirname(path);
    }
  }
}
const inside = (parent, child) => {
  const part = relative(parent, child);
  return part === '' || (!isAbsolute(part) && part !== '..' && !part.startsWith('..' + sep));
};
export async function pluginStateDirectory(root, configured) {
  try {
    if (!isAbsoluteStatePath(configured)) throw new Error('absolute state required');
    root = await realpath(root);
    const state = await resolvedLocation(resolve(configured));
    if (inside(root, state) || inside(state, root)) throw new Error('state overlaps installation');
    return state;
  } catch {
    throw new PluginStateError('Bench requires an absolute BENCHMARK_DATA_DIR outside its installation, with no overlap. Set BENCHMARK_DATA_DIR (the Claude plugin\'s data_directory option) to your private state folder before starting.');
  }
}
