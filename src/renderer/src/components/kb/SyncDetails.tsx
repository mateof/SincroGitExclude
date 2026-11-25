import { useTranslation } from 'react-i18next'
import type { KbBackend, KbFileChange, KbSyncLists, KbSyncLogEntry, KbSyncReport } from '../../../../shared/kb/types'

const MARK = {
  added: { sign: '+', color: 'text-success' },
  modified: { sign: '~', color: 'text-primary' },
  deleted: { sign: '-', color: 'text-destructive' }
}

const LISTS: Array<keyof KbSyncLists> = ['pulled', 'pushed', 'deletedLocal', 'deletedRemote', 'conflicts']

export function FileChanges({ files, total, onPick }: { files: KbFileChange[]; total: number; onPick?: (file: KbFileChange) => void }) {
  const { t } = useTranslation('kb')
  return (
    <ul className="space-y-0.5 font-mono text-[11px]">
      {files.map((file) => {
        const content = (
          <>
            <span className={`${MARK[file.status].color} w-2 shrink-0`} aria-hidden>
              {MARK[file.status].sign}
            </span>
            <span className={`break-all ${file.status === 'deleted' ? 'line-through opacity-70' : ''}`}>{file.path}</span>
          </>
        )
        return (
          <li key={file.path} title={t(`sync.file.${file.status}`)}>
            {onPick ? (
              <button type="button" onClick={() => onPick(file)} className="flex gap-1.5 text-left hover:text-primary">
                {content}
              </button>
            ) : (
              <span className="flex gap-1.5 select-text">{content}</span>
            )}
          </li>
        )
      })}
      {total > files.length && <li className="text-muted-foreground">{t('sync.more', { count: total - files.length })}</li>}
    </ul>
  )
}

export function SyncTotals({ totals }: { totals: KbSyncLogEntry['totals'] }) {
  const { t } = useTranslation('kb')
  const parts = LISTS.filter((k) => totals[k] > 0).map((k) => t(`sync.total.${k}`, { count: totals[k] }))
  return <div className="text-xs">{parts.join(' · ')}</div>
}

export function SyncLists({
  report,
  backend,
  totals,
  open = false,
  onOpenNote
}: {
  report: KbSyncReport
  backend: KbBackend
  totals?: KbSyncLogEntry['totals']
  open?: boolean
  onOpenNote?: (path: string) => void
}) {
  const { t } = useTranslation('kb')
  const titleOf = (list: keyof KbSyncLists): string =>
    list === 'deletedLocal' && backend === 'git' ? t('sync.deletedHere') : t(`sync.${list}`)
  return (
    <div className="space-y-1.5">
      {LISTS.filter((list) => report[list].length > 0).map((list) => {
        const total = totals?.[list] ?? report[list].length
        const canOpen = onOpenNote && (list === 'pulled' || list === 'pushed' || list === 'conflicts')
        return (
          <details key={list} className="text-xs" open={open}>
            <summary className="cursor-pointer text-muted-foreground">
              {titleOf(list)} ({total})
            </summary>
            <ul className="mt-1 ml-4 list-disc space-y-0.5 font-mono text-[11px] select-text">
              {report[list].map((path) => (
                <li key={path} className="break-all">
                  {canOpen && path.endsWith('.md') ? (
                    <button type="button" className="text-left hover:text-primary hover:underline" onClick={() => onOpenNote(path)}>
                      {path}
                    </button>
                  ) : (
                    path
                  )}
                </li>
              ))}
              {total > report[list].length && <li className="text-muted-foreground">{t('sync.more', { count: total - report[list].length })}</li>}
            </ul>
          </details>
        )
      })}
      {report.secrets.length > 0 && (
        <details className="text-xs" open={open}>
          <summary className="cursor-pointer text-muted-foreground">
            {t('sync.secrets')} ({report.secrets.length})
          </summary>
          <ul className="mt-1 ml-4 list-disc space-y-0.5 font-mono text-[11px] select-text">
            {report.secrets.map((s) => (
              <li key={`${s.path}:${s.line}:${s.rule}`} className="break-all">{`${s.path}:${s.line} (${s.rule})`}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
