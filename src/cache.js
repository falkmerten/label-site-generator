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

module.exports = { readCache, writeCache };
