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

export function isCloudSyncedPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/')
  return CLOUD_SYNC_MARKERS.some((marker) =>
    normalized.toLowerCase().includes('/' + marker.toLowerCase())
  )
}
