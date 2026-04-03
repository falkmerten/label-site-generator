const fs = require('fs/promises');
const path = require('path');

async function readCache(cachePath) {
  try {
    const content = await fs.readFile(cachePath, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    return null;
  }
}

async function writeCache(cachePath, data) {
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Creates a timestamped backup of the cache file before destructive operations.
 * Backup is saved as cache.backup.{timestamp}.json in the same directory.
 * @param {string} cachePath
 * @returns {Promise<string|null>} Path to backup file, or null if no cache exists
 */
async function backupCache(cachePath) {
  try {
    await fs.access(cachePath);
  } catch {
    return null; // no cache to backup
  }
  const dir = path.dirname(cachePath);
  const ext = path.extname(cachePath);
  const base = path.basename(cachePath, ext);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupPath = path.join(dir, `${base}.backup.${timestamp}${ext}`);
  await fs.copyFile(cachePath, backupPath);
  return backupPath;
}

module.exports = { readCache, writeCache, backupCache };
