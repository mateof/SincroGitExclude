import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/stores/ui-store'
import type { Repo } from '@/types'
import { FolderGit2, AlertCircle, ShieldOff } from 'lucide-react'

interface RepoListProps {
  repos: Repo[]
}

export function RepoList({ repos }: RepoListProps) {
  const { t } = useTranslation('repos')
  const { selectedRepoId, selectRepo } = useUIStore()

  return (
    <div className="py-1">
      {repos.map((repo) => {
        const isSelected = selectedRepoId === repo.id
        const warning = !repo.pathExists
          ? t('status.pathMissing')
          : !repo.isValidGit
            ? t('status.notGitRepo')
            : null

        return (
          <button
            key={repo.id}
            onClick={() => selectRepo(repo.id)}
            className={`w-full text-left px-3 py-2 flex items-center gap-2.5 transition-colors ${
              isSelected
                ? 'bg-primary/10 text-primary border-r-2 border-primary'
                : 'hover:bg-secondary text-foreground'
            }`}
          >
            <FolderGit2
              className={`w-4 h-4 shrink-0 ${
                isSelected ? 'text-primary' : 'text-muted-foreground'
              }`}
            />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">{repo.displayName}</div>
              <div className="text-[10px] text-muted-foreground truncate" title={repo.path}>
                {repo.path}
              </div>
              <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
                {repo.deploymentCount > 0 ? (
                  <>
                    <span>{t('list.deploymentCount', { count: repo.deploymentCount })}</span>
                    {repo.filesCount > 0 && (
                      <span>· {t('list.filesCount', { count: repo.filesCount })}</span>
                    )}
                  </>
                ) : (
                  <span className="text-warning">{t('list.standalone')}</span>
                )}
              </div>
              {repo.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {repo.tags.map((tag) => (
                    <span
                      key={tag.id}
                      className="inline-flex items-center gap-0.5 px-1.5 py-0 rounded-full text-[9px] font-medium"
                      style={{ backgroundColor: tag.color + '20', color: tag.color }}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: tag.color }}
                      />
                      {tag.name}
                    </span>
                  ))}
                </div>
              )}
              {warning && (
                <div className="flex items-center gap-1 mt-0.5 text-[10px] text-destructive">
                  {!repo.pathExists ? (
                    <AlertCircle className="w-3 h-3" />
                  ) : (
                    <ShieldOff className="w-3 h-3" />
                  )}
                  <span>{warning}</span>
                </div>
              )}
            </div>
          </button>
        )
      })}
    </div>
  )
}
