import { realpathSync } from 'fs'
import { basename as basenamePath, dirname as dirnamePath, join as joinPath, resolve as resolvePath } from 'path'

/**
 * Turns low-level errors into messages that tell the user what to do.
 *
 * The motivating case: the app data folder can be placed inside a cloud-synced
 * directory (Synology Drive, Dropbox, OneDrive, iCloud, Google Drive). The sync
 * client rewrites the SQLite `-wal`/`-shm` files underneath the running
 * connection, and SQLite then fails intermittently with "disk I/O error".
 * The raw message gives no hint of that, so operations looked randomly broken.
 */
export function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)

  if (/disk I\/O error|database disk image is malformed|SQLITE_IOERR/i.test(message)) {
    return (
      `${message} — the database could not be read or written. ` +
      'This is typical when the application data folder lives inside a ' +
      'cloud-synced folder (Synology Drive, Dropbox, OneDrive, iCloud, Google ' +
      'Drive): the sync client modifies the SQLite files while the app is ' +
      'using them. Move the data location to a local folder from ' +
      'Settings → Application data.'
    )
  }

  // Same root cause seen from git instead of SQLite: on a file-provider mount
  // (Synology Drive, iCloud, …) git's mmap fails and refs/objects become
  // unreadable, so HEAD resolves to nothing and branches "do not exist".
  if (
    /mmap failed|Stale NFS file handle|unable to read tree|no es posible leer el árbol|is corrupt|empty string is not a valid pathspec/i.test(
      message
    )
  ) {
    return (
      `${message} — the internal repository could not be read. This happens when ` +
      'the application data folder is on a cloud-synced or network filesystem ' +
      '(Synology Drive, Dropbox, OneDrive, iCloud, Google Drive), where git ' +
      'cannot memory-map its object files. Move the data location to a local ' +
      'folder from Settings → Application data.'
    )
  }

  if (/database is locked|SQLITE_BUSY/i.test(message)) {
    return (
      `${message} — the database is locked by another process. Close any other ` +
      'instance of the application and try again.'
    )
  }

  return message
}

/** Directories managed by a sync client, where SQLite in WAL mode is unreliable */
const CLOUD_SYNC_MARKERS = [
  'CloudStorage',
  'Dropbox',
  'OneDrive',
  'Google Drive',
  'GoogleDrive',
  'iCloud Drive',
  'Mobile Documents',
  'Nextcloud',
  'ownCloud',
  'pCloud',
  'MEGA',
  'Sync.com',
  'Box Sync',
  'SynologyDrive'
]

function hasCloudMarker(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').toLowerCase()
  return CLOUD_SYNC_MARKERS.some((marker) => normalized.includes('/' + marker.toLowerCase()))
}

function realPathOfNearestExisting(path: string): string | null {
  let current = resolvePath(path)
  const missing: string[] = []
  for (;;) {
    try {
      return joinPath(realpathSync.native(current), ...missing.reverse())
    } catch {
      const parent = dirnamePath(current)
      if (parent === current) return null
      missing.push(basenamePath(current))
      current = parent
    }
  }
}

export function isCloudSyncedPath(path: string): boolean {
  if (hasCloudMarker(path)) return true
  const real = realPathOfNearestExisting(path)
  return real !== null && hasCloudMarker(real)
}
