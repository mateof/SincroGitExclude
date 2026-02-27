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
