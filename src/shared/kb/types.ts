import type { GitAuthMode, RemoteLinks } from './git-remote'

export type KbBackend = 'none' | 'git' | 'folder' | 'sftp'

export interface GitBackendConfig {
  remoteUrl: string
  branch: string
  gitAuth?: GitAuthMode
  gitUsername?: string
  sshKeyPath?: string
  authorName?: string
  authorEmail?: string
}

export interface FolderBackendConfig {
  path: string
}

export interface SftpBackendConfig {
  host: string
  port: number
  username: string
  remotePath: string
  auth: 'agent' | 'key'
  privateKeyPath?: string
  hostFingerprint?: string
}

export type KbBackendConfig = Partial<GitBackendConfig & FolderBackendConfig & SftpBackendConfig>

export interface KbSyncSettings {
  intervalMin: number
  onWrite: boolean
  autoCommitExternal: boolean
}

export interface KbSyncReport {
  at: string
  ok: boolean
  pulled: string[]
  pushed: string[]
  conflicts: string[]
  deletedLocal: string[]
  deletedRemote: string[]
  secrets: Array<{ path: string; rule: string; line: number }>
  blockedBy: 'secrets' | 'review' | 'locked' | 'rollback' | 'readonly' | null
  message: string | null
  commitsPulled?: number
  commitsPushed?: number
}

export type KbSyncTrigger = 'manual' | 'assistant' | 'schedule' | 'write' | 'assistant-write' | 'external' | 'app'

export type KbSyncLists = Pick<KbSyncReport, 'pulled' | 'pushed' | 'conflicts' | 'deletedLocal' | 'deletedRemote'>

export interface KbSyncLogEntry {
  id: number
  firstAt: string
  at: string
  repeats: number
  trigger: KbSyncTrigger
  durationMs: number
  report: KbSyncReport
  totals: Record<keyof KbSyncLists, number>
}

export interface KbSyncActivity {
  entries: KbSyncLogEntry[]
  nextAt: string | null
}

export interface KbFileChange {
  path: string
  status: 'added' | 'modified' | 'deleted'
  added?: number | null
  removed?: number | null
}

export interface KbGitCommit {
  hash: string
  merge: boolean
  date: string
  author: string
  email: string
  subject: string
  pushed: boolean
  files: KbFileChange[]
  fileCount: number
}

export interface KbGitCommitDetail extends KbGitCommit {
  body: string
}

export interface KbGitOverview {
  branch: string
  remote: RemoteLinks | null
  head: KbGitCommit | null
  remoteHead: string | null
  ahead: number
  behind: number
  commits: number
  pending: KbFileChange[]
  pendingCount: number
}

export interface KbSpace {
  id: string
  name: string
  localPath: string
  parentId: string | null
  backend: KbBackend
  backendConfig: KbBackendConfig
  sync: KbSyncSettings
  agentWrite: boolean
  reviewBeforePush: boolean
  shared: boolean
  encrypted: boolean
  lastSyncAt: string | null
  lastSyncStatus: KbSyncReport | null
  createdAt: string
  exists: boolean
  cloudSynced: boolean
  stats: { notes: number; files: number; tags: number; unresolved: number } | null
  pendingReview: number
  locked: boolean
  gitCredential: 'stored' | 'missing' | null
}

export interface KbSpaceInput {
  name?: string
  localPath: string
  parentId?: string | null
  backend?: KbBackend
  backendConfig?: KbBackendConfig
  sync?: Partial<KbSyncSettings>
  agentWrite?: boolean
  reviewBeforePush?: boolean
  shared?: boolean
}

export interface KbTreeNode {
  name: string
  path: string
  type: 'folder' | 'note' | 'file'
  title?: string
  children?: KbTreeNode[]
  noteCount?: number
}

export interface KbLinkView {
  target: string
  heading: string | null
  alias: string | null
  embed: boolean
  line: number
  resolved: { spaceId: string; path: string; title: string } | null
  crossesToPrivate: boolean
}

export interface KbNoteView {
  spaceId: string
  path: string
  absolutePath: string
  title: string
  content: string
  body: string
  frontmatter: Record<string, unknown>
  frontmatterError: string | null
  tags: string[]
  headings: Array<{ level: number; text: string; line: number }>
  outgoing: KbLinkView[]
  backlinks: Array<{ spaceId: string; path: string; title: string; line: number }>
  hash: string
  mtimeMs: number
  size: number
}

export interface KbSearchHit {
  spaceId: string
  path: string
  title: string
  score: number
  snippet: string
  tags: string[]
  heading?: string
  matchedBy: Array<'text' | 'semantic'>
}

export type KbSearchMode = 'text' | 'semantic' | 'hybrid'

export interface KbSearchOptions {
  spaceIds?: string[]
  folder?: string
  tags?: string[]
  limit?: number
  mode?: KbSearchMode
}

export interface KbOrigin {
  source: 'ui' | 'mcp' | 'web'
  tokenName?: string
  tool?: string
}

export interface KbAuditEntry {
  id: number
  at: string
  source: string
  tokenName: string | null
  tool: string | null
  spaceId: string
  path: string
  hashBefore: string | null
  hashAfter: string | null
  reviewState: 'pending' | 'approved' | 'reverted' | null
}

export interface KbHistoryEntry {
  hash: string
  date: string
  author: string
  subject: string
}

export interface KbRepoIntegrations {
  pointer: boolean
  mcpJson: boolean
  sessionHook: boolean
  agentsMd: boolean
}

export interface KbRepoLinkInput {
  repoPath: string
  spaceId: string
  notePath: string
  createNote?: boolean
  language?: 'es' | 'en'
  integrations: KbRepoIntegrations
  remote?: { mcpUrl: string; spaceName: string }
}

export interface KbRepoLinkPlanItem {
  file: string
  action: 'create' | 'update' | 'skip' | 'remove'
  reason?: string
}

export interface KbRepoLink {
  repoId: string
  repoPath: string
  spaceId: string
  notePath: string
  integrations: KbRepoIntegrations
  remote: { mcpUrl: string; spaceName: string } | null
  createdAt: string
  pointerPresent: boolean
}

export interface KbRepoContext {
  repoPath: string
  spaceId: string
  spaceName: string
  notePath: string
  title: string
  hash: string
  content: string
  links: Array<{ path: string; title: string }>
  backlinks: Array<{ path: string; title: string }>
}

export interface KbRepoSuggestion {
  repoId: string
  repoPath: string
  remoteUrl: string
  spaceId: string
  notePath: string
}

export interface KbCryptoStatus {
  enabled: boolean
  unlocked: boolean
  deviceId: string | null
  deviceName: string | null
  canRememberOnDevice: boolean
  remembered: boolean
  members: Array<{ id: string; name: string; role: 'admin' | 'writer' | 'reader'; fingerprint: string; isMe: boolean }>
  devices: Array<{ id: string; name: string; fingerprint: string; isMe: boolean }>
  pendingPairings: Array<{ id: string; name: string; sas: string[] }>
  lastSeq: number
}

export interface KbSemanticStatus {
  provider: 'local' | 'ollama' | 'openai' | 'off'
  model: string
  ready: boolean
  indexing: boolean
  chunks: number
  embedded: number
  error: string | null
  downloadProgress: number | null
}

export interface KbSemanticConfig {
  provider: 'local' | 'ollama' | 'openai' | 'off'
  model: string
  endpoint?: string
  apiKeyEnv?: string
}
