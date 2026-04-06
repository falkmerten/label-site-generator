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
  const tmpPath = cachePath + '.tmp';
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmpPath, cachePath);
}

/**
 * Rotates backup files, keeping at most `maxBackups` files.
 * Lists cache.backup.*.json files, sorts by timestamp, deletes oldest exceeding limit.
 * @param {string} cachePath
 * @param {number} maxBackups
 */
async function rotateBackups(cachePath, maxBackups = 5) {
  const dir = path.dirname(cachePath) || '.';
  const ext = path.extname(cachePath);
  const base = path.basename(cachePath, ext);
  const pattern = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.backup\\.\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}${ext.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

  let entries;
  try {
    entries = await fs.readdir(dir);
  } catch {
    return;
  }

  const backups = entries.filter(f => pattern.test(f)).sort();
  const toDelete = backups.length > maxBackups ? backups.slice(0, backups.length - maxBackups) : [];
  for (const file of toDelete) {
    try {
      await fs.unlink(path.join(dir, file));
    } catch { /* ignore */ }
  }
}

/**
 * Creates a timestamped backup of the cache file before destructive operations.
 * Backup is saved as cache.backup.{timestamp}.json in the same directory.
 * After creating the backup, rotates old backups to keep at most 5.
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
  await rotateBackups(cachePath);
  return backupPath;
}

module.exports = { readCache, writeCache, backupCache, rotateBackups };
