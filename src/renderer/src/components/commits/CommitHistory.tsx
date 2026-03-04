import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CommitInfo, Deployment, IpcResult, SnapshotInfo } from '@/types'
import { CommitRow } from './CommitRow'
import { SnapshotList } from './SnapshotList'
import { Camera, GitBranch } from 'lucide-react'

interface CommitHistoryProps {
  deployment: Deployment
  onCheckout: (commit: CommitInfo) => void
  onViewDiff: (hash1: string, hash2?: string) => void
  onViewFile: (hash: string) => void
  onNewDeployment?: (commitHash: string) => void
  onExtractFiles?: (commitHash: string) => void
  onViewSnapshot?: (snapshotId: string) => void
  onApplySnapshot?: (snapshotId: string) => void
  onDeploySnapshot?: (snapshotId: string) => void
}

// Special key for snapshots with no base commit (pre-first-commit)
const NULL_BASE_KEY = '__null_base__'

export function CommitHistory({ deployment, onCheckout, onViewDiff, onViewFile, onNewDeployment, onExtractFiles, onViewSnapshot, onApplySnapshot, onDeploySnapshot }: CommitHistoryProps) {
  const { t } = useTranslation('commits')
  const [commits, setCommits] = useState<CommitInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedCommit, setExpandedCommit] = useState<string | null>(null)
  const [snapshotCounts, setSnapshotCounts] = useState<Map<string, number>>(new Map())
  const [loadedSnapshots, setLoadedSnapshots] = useState<Map<string, SnapshotInfo[]>>(new Map())
  const [orphanCount, setOrphanCount] = useState(0)
  const [orphanSnapshots, setOrphanSnapshots] = useState<SnapshotInfo[]>([])
  const [showOrphans, setShowOrphans] = useState(false)

  // Reload when deployment changes or after a commit (currentCommitHash changes)
  useEffect(() => {
    loadCommits()
  }, [deployment.id, deployment.currentCommitHash])

  // Refresh snapshot counts when watcher detects file changes (new snapshots may appear after debounce)
  useEffect(() => {
    const unsub = window.api.on('watcher:file-changed', (deploymentId: unknown) => {
      if (deploymentId === deployment.id && commits.length > 0) {
        // Delay to allow snapshot creation debounce (2s) + margin
        setTimeout(() => {
          loadSnapshotCounts(commits)
          loadOrphanCount()
        }, 3000)
      }
    })
    return () => { unsub() }
  }, [deployment.id, commits])

  const loadCommits = async () => {
    setLoading(true)
    const result = await window.api.invoke<IpcResult<CommitInfo[]>>(
      'commits:list',
      deployment.id
    )
    if (result.success && result.data) {
      setCommits(result.data)
      loadSnapshotCounts(result.data)
    }
    // Also load orphan snapshot count (base_commit_hash IS NULL)
    loadOrphanCount()
    setLoading(false)
  }

  const loadSnapshotCounts = async (commitList: CommitInfo[]) => {
    const counts = new Map<string, number>()
    for (const commit of commitList) {
      const result = await window.api.invoke<IpcResult<number>>(
        'snapshots:count-for-commit',
        deployment.id,
        commit.hash
      )
      if (result.success && result.data !== undefined) {
        counts.set(commit.hash, result.data)
      }
    }
    setSnapshotCounts(new Map(counts))
  }

  const loadOrphanCount = async () => {
    const result = await window.api.invoke<IpcResult<number>>(
      'snapshots:count-for-commit',
      deployment.id,
      null
    )
    if (result.success && result.data !== undefined) {
      setOrphanCount(result.data)
      // Auto-expand if no commits and there are orphan snapshots
      if (result.data > 0) {
        loadOrphanSnapshots()
      }
    }
  }

  const loadOrphanSnapshots = async () => {
    const result = await window.api.invoke<IpcResult<SnapshotInfo[]>>(
      'snapshots:between-commits',
      deployment.id,
      null
    )
    if (result.success && result.data) {
      setOrphanSnapshots(result.data)
    }
  }

  const handleToggleSnapshots = async (commitHash: string, index: number) => {
    if (expandedCommit === commitHash) {
      setExpandedCommit(null)
      return
    }

    setExpandedCommit(commitHash)

    if (!loadedSnapshots.has(commitHash)) {
      // Determine the next commit hash (the one before in the list, which is newer)
      const nextCommitHash = index > 0 ? commits[index - 1].hash : undefined
      const result = await window.api.invoke<IpcResult<SnapshotInfo[]>>(
        'snapshots:between-commits',
        deployment.id,
        commitHash,
        nextCommitHash
      )
      if (result.success && result.data) {
        setLoadedSnapshots((prev) => new Map(prev).set(commitHash, result.data!))
      }
    }
  }

  const handleToggleOrphans = () => {
    setShowOrphans(!showOrphans)
    if (orphanSnapshots.length === 0) {
      loadOrphanSnapshots()
    }
  }

  if (loading) {
    return (
      <div className="text-center py-8 text-sm text-muted-foreground">Loading...</div>
    )
  }

  const snapshotActions = {
    onView: onViewSnapshot ?? (() => {}),
    onApply: onApplySnapshot ?? (() => {}),
    onDeploy: onDeploySnapshot ?? (() => {})
  }

  // When no commits exist but there are orphan snapshots
  if (commits.length === 0) {
    return (
      <div>
        <div className="flex items-center gap-2 mb-4">
          <GitBranch className="w-4 h-4 text-muted-foreground" />
          <span className="text-xs font-mono text-muted-foreground">{deployment.branchName}</span>
          <span className="text-xs text-muted-foreground">-</span>
          <span className="text-xs text-muted-foreground truncate">{deployment.repoPath.split(/[/\\]/).slice(-1)[0]}</span>
        </div>

        <div className="text-center py-8 text-sm text-muted-foreground border border-dashed border-border rounded-lg">
          {t('messages.noCommits')}
        </div>

        {orphanCount > 0 && (
          <div className="mt-4">
            <button
              onClick={handleToggleOrphans}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors ${
                showOrphans
                  ? 'bg-primary/20 text-primary'
                  : 'bg-secondary text-muted-foreground hover:text-foreground'
              }`}
            >
              <Camera className="w-3.5 h-3.5" />
              {t('snapshots.toggle', { count: orphanCount })}
            </button>
            {showOrphans && (
              <div className="mt-2">
                <SnapshotList
                  snapshots={orphanSnapshots}
                  {...snapshotActions}
                />
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <GitBranch className="w-4 h-4 text-muted-foreground" />
        <span className="text-xs font-mono text-muted-foreground">{deployment.branchName}</span>
        <span className="text-xs text-muted-foreground">-</span>
        <span className="text-xs text-muted-foreground truncate">{deployment.repoPath.split(/[/\\]/).slice(-1)[0]}</span>
      </div>

      <div className="relative">
        {/* Timeline line */}
        <div className="absolute left-[11px] top-3 bottom-3 w-px bg-border" />

        <div className="space-y-0">
          {commits.map((commit, index) => {
            const isCurrent = deployment.currentCommitHash
              ? commit.hash === deployment.currentCommitHash
              : index === 0
            const count = snapshotCounts.get(commit.hash) ?? 0
            const isExpanded = expandedCommit === commit.hash
            const snapshots = loadedSnapshots.get(commit.hash) ?? []

            return (
            <CommitRow
              key={commit.hash}
              commit={commit}
              isCurrent={isCurrent}
              isFirst={index === 0}
              isLast={index === commits.length - 1}
              onCheckout={() => onCheckout(commit)}
              onViewDiff={() => {
                if (index < commits.length - 1) {
                  onViewDiff(commits[index + 1].hash, commit.hash)
                } else {
                  onViewDiff(commit.hash)
                }
              }}
              onViewFile={() => onViewFile(commit.hash)}
              onNewDeployment={onNewDeployment ? () => onNewDeployment(commit.hash) : undefined}
              onExtractFiles={onExtractFiles ? () => onExtractFiles(commit.hash) : undefined}
              snapshotCount={count}
              onToggleSnapshots={() => handleToggleSnapshots(commit.hash, index)}
              showSnapshots={isExpanded}
            >
              <SnapshotList
                snapshots={snapshots}
                {...snapshotActions}
              />
            </CommitRow>
            )
          })}
        </div>
      </div>

      {/* Orphan snapshots (created before any commit) */}
      {orphanCount > 0 && (
        <div className="mt-3 ml-[11px] pl-3 border-l border-dashed border-border">
          <button
            onClick={handleToggleOrphans}
            className={`inline-flex items-center gap-1.5 px-2 py-1 text-[11px] rounded transition-colors ${
              showOrphans
                ? 'bg-primary/20 text-primary'
                : 'bg-secondary text-muted-foreground hover:text-foreground'
            }`}
          >
            <Camera className="w-3 h-3" />
            {t('snapshots.toggle', { count: orphanCount })} (pre-commit)
          </button>
          {showOrphans && (
            <div className="mt-1">
              <SnapshotList
                snapshots={orphanSnapshots}
                {...snapshotActions}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
