import { readFile, rename, writeFile } from 'node:fs/promises';

import { mergeEnvironment } from './core.mjs';

export async function readEnvironmentFile(fileUrl) {
  try {
    return await readFile(fileUrl, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

export function parseEnvironment(source) {
  const result = {};
  for (const rawLine of String(source).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    result[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return result;
}

export async function writeRuntimeEnvironment(fileUrl, current, values) {
  const temporaryUrl = new URL(`${fileUrl.pathname}.tmp`, fileUrl);
  await writeFile(temporaryUrl, mergeEnvironment(current, values), {
    encoding: 'utf8',
    mode: 0o600,
  });
  await rename(temporaryUrl, fileUrl);
}

