'use strict'

const fs = require('fs/promises')
const path = require('path')
const { execSync } = require('child_process')

const SYNC_STATE_FILE = '.sync-state.json'
const SYNC_ARCHIVE = 'workspace-sync.tar.gz'

// ── State Management ─────────────────────────────────────────────────────────

/**
 * Loads the local sync state (last known remote version).
 * @returns {Promise<{versionId: string|null, lastSync: string|null, backend: string|null}>}
 */
async function loadSyncState () {
  try {
    const raw = await fs.readFile(SYNC_STATE_FILE, 'utf8')
    return JSON.parse(raw)
  } catch {
    return { versionId: null, lastSync: null, backend: null }
  }
}

/**
 * Saves the local sync state.
 * @param {object} state
 */
async function saveSyncState (state) {
  await fs.writeFile(SYNC_STATE_FILE, JSON.stringify(state, null, 2), 'utf8')
}

// ── Archive Helpers ──────────────────────────────────────────────────────────

/**
 * Creates a tar.gz archive of cache.json + content/ directory.
 * @param {string} cachePath - Path to cache.json
 * @param {string} contentDir - Path to content directory
 * @param {string} outputPath - Path for the archive
 */
async function createArchive (cachePath, contentDir, outputPath) {
  // Use tar to create archive (available on Windows via Git Bash)
  const files = []
  try { await fs.access(cachePath); files.push(path.basename(cachePath)) } catch { /* no cache */ }
  try { await fs.access(contentDir); files.push(path.basename(contentDir)) } catch { /* no content */ }

  if (files.length === 0) {
    throw new Error('[sync] Nothing to sync — no cache.json or content/ found')
  }

  execSync(`tar -czf "${outputPath}" ${files.join(' ')}`, { stdio: 'pipe' })
}

/**
 * Extracts a tar.gz archive to the current directory.
 * @param {string} archivePath - Path to the archive
 */
async function extractArchive (archivePath) {
  execSync(`tar -xzf "${archivePath}"`, { stdio: 'pipe' })
}

// ── S3 Backend ───────────────────────────────────────────────────────────────

/**
 * Gets the current version ID of the sync archive in S3.
 * @param {object} config - Sync config { bucket, prefix, region }
 * @returns {Promise<{versionId: string|null, lastModified: string|null}>}
 */
async function s3GetVersion (config) {
  const key = `${config.prefix || ''}${SYNC_ARCHIVE}`
  const regionFlag = config.region ? ` --region ${config.region}` : ''
  try {
    const result = execSync(
      `aws s3api head-object --bucket ${config.bucket} --key "${key}"${regionFlag} --output json`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    )
    const meta = JSON.parse(result)
    return {
      versionId: meta.VersionId || null,
      lastModified: meta.LastModified || null
    }
  } catch {
    return { versionId: null, lastModified: null }
  }
}

/**
 * Downloads the sync archive from S3.
 * @param {object} config - Sync config
 * @param {string} destPath - Local path to save the archive
 */
async function s3Download (config, destPath) {
  const key = `${config.prefix || ''}${SYNC_ARCHIVE}`
  const regionFlag = config.region ? ` --region ${config.region}` : ''
  execSync(
    `aws s3 cp "s3://${config.bucket}/${key}" "${destPath}"${regionFlag}`,
    { stdio: 'pipe' }
  )
}

/**
 * Uploads the sync archive to S3.
 * @param {object} config - Sync config
 * @param {string} srcPath - Local archive path
 * @returns {Promise<string|null>} New version ID
 */
async function s3Upload (config, srcPath) {
  const key = `${config.prefix || ''}${SYNC_ARCHIVE}`
  const regionFlag = config.region ? ` --region ${config.region}` : ''
  const result = execSync(
    `aws s3api put-object --bucket ${config.bucket} --key "${key}" --body "${srcPath}"${regionFlag} --output json`,
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  )
  const meta = JSON.parse(result)
  return meta.VersionId || null
}

// ── Local Backend ────────────────────────────────────────────────────────────

/**
 * Gets the modification time of the local sync archive in the sync directory.
 * @param {object} config - Sync config { dir }
 * @returns {Promise<{lastModified: string|null}>}
 */
async function localGetVersion (config) {
  const archivePath = path.join(config.dir, SYNC_ARCHIVE)
  try {
    const stat = await fs.stat(archivePath)
    return { lastModified: stat.mtime.toISOString(), versionId: stat.mtime.toISOString() }
  } catch {
    return { lastModified: null, versionId: null }
  }
}

/**
 * Copies the sync archive from the local sync directory.
 * @param {object} config - Sync config
 * @param {string} destPath - Local path to save the archive
 */
async function localDownload (config, destPath) {
  const archivePath = path.join(config.dir, SYNC_ARCHIVE)
  await fs.copyFile(archivePath, destPath)
}

/**
 * Copies the sync archive to the local sync directory.
 * @param {object} config - Sync config
 * @param {string} srcPath - Local archive path
 * @returns {Promise<string|null>} Timestamp as version
 */
async function localUpload (config, srcPath) {
  await fs.mkdir(config.dir, { recursive: true })
  const archivePath = path.join(config.dir, SYNC_ARCHIVE)
  await fs.copyFile(srcPath, archivePath)
  const stat = await fs.stat(archivePath)
  return stat.mtime.toISOString()
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Pulls the latest workspace state from the configured sync backend.
 * Only downloads if remote is newer than last sync.
 *
 * @param {object} syncConfig - Sync configuration from config.json
 * @param {object} [options] - { cachePath, contentDir, force }
 * @returns {Promise<boolean>} true if data was pulled
 */
async function syncDown (syncConfig, options = {}) {
  const { cachePath = './cache.json', contentDir = './content', force = false } = options
  const backend = syncConfig.backend || 's3'

  console.log(`[sync] Checking remote (${backend})...`)

  // Get remote version
  let remote
  if (backend === 's3') {
    remote = await s3GetVersion(syncConfig)
  } else {
    remote = await localGetVersion(syncConfig)
  }

  if (!remote.versionId && !remote.lastModified) {
    console.log('[sync] No remote state found — skipping pull')
    return false
  }

  // Compare with local state
  const state = await loadSyncState()
  if (!force && state.versionId && state.versionId === remote.versionId) {
    console.log('[sync] Local state is up to date')
    return false
  }

  // Download and extract
  console.log('[sync] Pulling workspace state...')
  const tmpArchive = `.sync-download-${Date.now()}.tar.gz`
  try {
    if (backend === 's3') {
      await s3Download(syncConfig, tmpArchive)
    } else {
      await localDownload(syncConfig, tmpArchive)
    }
    await extractArchive(tmpArchive)
    await saveSyncState({
      versionId: remote.versionId,
      lastSync: new Date().toISOString(),
      backend
    })
    console.log('[sync] Pull complete')
    return true
  } finally {
    try { await fs.unlink(tmpArchive) } catch { /* cleanup */ }
  }
}

/**
 * Pushes the local workspace state to the configured sync backend.
 * Uses optimistic locking (S3): fails if remote changed since last pull.
 *
 * @param {object} syncConfig - Sync configuration from config.json
 * @param {object} [options] - { cachePath, contentDir, force }
 * @returns {Promise<boolean>} true if data was pushed
 */
async function syncUp (syncConfig, options = {}) {
  const { cachePath = './cache.json', contentDir = './content', force = false } = options
  const backend = syncConfig.backend || 's3'

  // Optimistic locking (S3 only): check if remote changed since our last pull
  if (backend === 's3' && !force) {
    const state = await loadSyncState()
    const remote = await s3GetVersion(syncConfig)
    if (state.versionId && remote.versionId && state.versionId !== remote.versionId) {
      console.error('[sync] Remote has changed since your last pull!')
      console.error('       Run --sync-down first, or use --sync-up --force to overwrite.')
      return false
    }
  }

  console.log(`[sync] Pushing workspace state (${backend})...`)

  const tmpArchive = `.sync-upload-${Date.now()}.tar.gz`
  try {
    await createArchive(cachePath, contentDir, tmpArchive)

    let newVersionId
    if (backend === 's3') {
      newVersionId = await s3Upload(syncConfig, tmpArchive)
    } else {
      newVersionId = await localUpload(syncConfig, tmpArchive)
    }

    await saveSyncState({
      versionId: newVersionId,
      lastSync: new Date().toISOString(),
      backend
    })
    console.log('[sync] Push complete')
    return true
  } finally {
    try { await fs.unlink(tmpArchive) } catch { /* cleanup */ }
  }
}

/**
 * Resolves sync configuration from config.json or .env.
 * @param {object} config - Parsed config.json
 * @returns {object|null} Sync config or null if not configured
 */
function resolveSyncConfig (config) {
  // Priority 1: config.json sync section
  if (config && config.sync && config.sync.backend) {
    return config.sync
  }

  // Priority 2: env vars (S3 backend)
  if (process.env.SYNC_BUCKET) {
    return {
      backend: 's3',
      bucket: process.env.SYNC_BUCKET,
      prefix: process.env.SYNC_PREFIX || '',
      region: process.env.SYNC_REGION || process.env.AWS_S3_REGION || 'eu-central-1'
    }
  }

  // Priority 3: env var (local backend)
  if (process.env.SYNC_DIR) {
    return {
      backend: 'local',
      dir: process.env.SYNC_DIR
    }
  }

  return null
}

module.exports = { syncDown, syncUp, resolveSyncConfig, loadSyncState, saveSyncState }
