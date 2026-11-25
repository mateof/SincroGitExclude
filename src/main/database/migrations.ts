import Database from 'better-sqlite3'
import log from 'electron-log'

interface Migration {
  version: number
  description: string
  up: string
}

const migrations: Migration[] = [
  {
    version: 1,
    description: 'Initial schema: files and deployments tables',
    up: `
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        alias TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS deployments (
        id TEXT PRIMARY KEY,
        file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
        repo_path TEXT NOT NULL,
        file_relative_path TEXT NOT NULL,
        branch_name TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        last_synced_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_deployments_file_branch
        ON deployments(file_id, branch_name);

      CREATE INDEX IF NOT EXISTS idx_deployments_file_id
        ON deployments(file_id);

      CREATE INDEX IF NOT EXISTS idx_deployments_active
        ON deployments(is_active);
    `
  },
  {
    version: 2,
    description: 'Add tags and file_tags tables',
    up: `
      CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        color TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS file_tags (
        file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (file_id, tag_id)
      );

      CREATE INDEX IF NOT EXISTS idx_file_tags_file_id ON file_tags(file_id);
      CREATE INDEX IF NOT EXISTS idx_file_tags_tag_id ON file_tags(tag_id);
    `
  },
  {
    version: 3,
    description: 'Add type column to files for bundle support',
    up: `
      ALTER TABLE files ADD COLUMN type TEXT NOT NULL DEFAULT 'file';
    `
  },
  {
    version: 4,
    description: 'Add current_commit_hash to deployments for tracking checked-out commit',
    up: `
      ALTER TABLE deployments ADD COLUMN current_commit_hash TEXT;
    `
  },
  {
    version: 5,
    description: 'Add use_auto_icon column to files for file-type icon preference',
    up: `
      ALTER TABLE files ADD COLUMN use_auto_icon INTEGER NOT NULL DEFAULT 1;
    `
  },
  {
    version: 6,
    description: 'Add description column to deployments',
    up: `
      ALTER TABLE deployments ADD COLUMN description TEXT;
    `
  },
  {
    version: 7,
    description: 'Add deployment_tags junction table',
    up: `
      CREATE TABLE IF NOT EXISTS deployment_tags (
        deployment_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (deployment_id, tag_id)
      );

      CREATE INDEX IF NOT EXISTS idx_deployment_tags_deployment_id ON deployment_tags(deployment_id);
      CREATE INDEX IF NOT EXISTS idx_deployment_tags_tag_id ON deployment_tags(tag_id);
    `
  },
  {
    version: 8,
    description: 'Add snapshots and snapshot_files tables for automatic file snapshots',
    up: `
      CREATE TABLE IF NOT EXISTS snapshots (
        id TEXT PRIMARY KEY,
        deployment_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
        base_commit_hash TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS snapshot_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        snapshot_id TEXT NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
        file_path TEXT NOT NULL,
        content BLOB NOT NULL,
        size INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_snapshots_deployment ON snapshots(deployment_id, base_commit_hash, created_at);
      CREATE INDEX IF NOT EXISTS idx_snapshot_files_snapshot ON snapshot_files(snapshot_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshot_files_path ON snapshot_files(snapshot_id, file_path);
    `
  },
  {
    version: 9,
    description: 'Add ignore_patterns column to files for bundle sync filtering',
    up: `
      ALTER TABLE files ADD COLUMN ignore_patterns TEXT NOT NULL DEFAULT '';
    `
  },
  {
    version: 10,
    description: 'Add repos and repo_tags tables; backfill repos from existing deployments',
    up: `
      CREATE TABLE IF NOT EXISTS repos (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        description TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_repos_path ON repos(path);

      CREATE TABLE IF NOT EXISTS repo_tags (
        repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
        tag_id  TEXT NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
        PRIMARY KEY (repo_id, tag_id)
      );

      CREATE INDEX IF NOT EXISTS idx_repo_tags_repo_id ON repo_tags(repo_id);
      CREATE INDEX IF NOT EXISTS idx_repo_tags_tag_id  ON repo_tags(tag_id);

      INSERT OR IGNORE INTO repos (id, path)
      SELECT lower(hex(randomblob(16))), repo_path
      FROM (SELECT DISTINCT repo_path FROM deployments);
    `
  },
  {
    version: 11,
    description: 'Remote sync: metadata timestamp on files and tombstones for deleted files',
    up: `
      ALTER TABLE files ADD COLUMN meta_updated_at TEXT;
      UPDATE files SET meta_updated_at = updated_at;

      CREATE TABLE IF NOT EXISTS sync_tombstones (
        file_id TEXT PRIMARY KEY,
        deleted_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `
  },
  {
    version: 12,
    description: 'Knowledge base: spaces, repo links, audit, sync and crypto state',
    up: `
      CREATE TABLE IF NOT EXISTS kb_spaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        local_path TEXT NOT NULL UNIQUE,
        parent_id TEXT REFERENCES kb_spaces(id) ON DELETE SET NULL,
        backend TEXT NOT NULL DEFAULT 'none',
        backend_config TEXT NOT NULL DEFAULT '{}',
        sync_interval_min INTEGER NOT NULL DEFAULT 0,
        sync_on_write INTEGER NOT NULL DEFAULT 0,
        auto_commit_external INTEGER NOT NULL DEFAULT 0,
        agent_write INTEGER NOT NULL DEFAULT 1,
        review_before_push INTEGER NOT NULL DEFAULT 0,
        shared INTEGER NOT NULL DEFAULT 0,
        encrypted INTEGER NOT NULL DEFAULT 0,
        last_sync_at TEXT,
        last_sync_status TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS kb_repo_links (
        repo_id TEXT PRIMARY KEY REFERENCES repos(id) ON DELETE CASCADE,
        space_id TEXT NOT NULL REFERENCES kb_spaces(id) ON DELETE CASCADE,
        note_path TEXT NOT NULL,
        integrations TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS kb_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at TEXT NOT NULL DEFAULT (datetime('now')),
        source TEXT NOT NULL,
        token_name TEXT,
        tool TEXT,
        space_id TEXT NOT NULL REFERENCES kb_spaces(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        hash_before TEXT,
        hash_after TEXT,
        before_content BLOB,
        review_state TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_kb_audit_space ON kb_audit(space_id, at);
      CREATE INDEX IF NOT EXISTS idx_kb_audit_review ON kb_audit(space_id, review_state);

      CREATE TABLE IF NOT EXISTS kb_sync_state (
        space_id TEXT NOT NULL REFERENCES kb_spaces(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        local_hash TEXT,
        remote_hash TEXT,
        remote_size INTEGER,
        remote_mtime INTEGER,
        PRIMARY KEY (space_id, path)
      );

      CREATE TABLE IF NOT EXISTS kb_crypto_state (
        space_id TEXT PRIMARY KEY REFERENCES kb_spaces(id) ON DELETE CASCADE,
        crypto_space_id TEXT NOT NULL,
        device_id TEXT,
        last_seq INTEGER NOT NULL DEFAULT 0,
        last_manifest_hash TEXT,
        last_epoch INTEGER NOT NULL DEFAULT 0,
        trusted_signers TEXT NOT NULL DEFAULT '[]'
      );
    `
  },
  {
    version: 13,
    description: 'Knowledge base: log of the syncs of each space',
    up: `
      CREATE TABLE IF NOT EXISTS kb_sync_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        space_id TEXT NOT NULL REFERENCES kb_spaces(id) ON DELETE CASCADE,
        first_at TEXT NOT NULL,
        at TEXT NOT NULL,
        repeats INTEGER NOT NULL DEFAULT 1,
        started_by TEXT NOT NULL,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        report TEXT NOT NULL,
        totals TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_kb_sync_log_space ON kb_sync_log(space_id, id);
    `
  }
]

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  const row = db.prepare('SELECT MAX(version) as v FROM schema_version').get() as
    | { v: number | null }
    | undefined
  const currentVersion = row?.v ?? 0

  for (const migration of migrations) {
    if (migration.version > currentVersion) {
      const transaction = db.transaction(() => {
        db.exec(migration.up)
        db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(migration.version)
      })
      transaction()
      log.info(`Applied migration ${migration.version}: ${migration.description}`)
    }
  }
}
