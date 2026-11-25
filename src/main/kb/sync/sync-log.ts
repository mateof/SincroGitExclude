import type { KbSyncLists, KbSyncLogEntry, KbSyncReport } from '../../../shared/kb/types'

export const LOG_ENTRIES_PER_SPACE = 200
export const LOG_FILES_PER_LIST = 300

const LISTS: Array<keyof KbSyncLists> = ['pulled', 'pushed', 'conflicts', 'deletedLocal', 'deletedRemote']

export function totalsOf(report: KbSyncReport): KbSyncLogEntry['totals'] {
  return {
    pulled: report.pulled.length,
    pushed: report.pushed.length,
    conflicts: report.conflicts.length,
    deletedLocal: report.deletedLocal.length,
    deletedRemote: report.deletedRemote.length
  }
}

export function capReport(report: KbSyncReport): KbSyncReport {
  const capped = { ...report, secrets: report.secrets.slice(0, LOG_FILES_PER_LIST) }
  for (const list of LISTS) capped[list] = report[list].slice(0, LOG_FILES_PER_LIST)
  return capped
}

function moved(report: KbSyncReport): boolean {
  return LISTS.some((list) => report[list].length > 0)
}

function failed(report: KbSyncReport): boolean {
  return !report.ok || report.blockedBy !== null
}

export function logAction(previous: KbSyncReport | null, report: KbSyncReport): 'insert' | 'repeat' | 'skip' {
  if (moved(report)) return 'insert'
  if (!failed(report)) return previous && failed(previous) ? 'insert' : 'skip'
  const same = previous && failed(previous) && !moved(previous) && previous.blockedBy === report.blockedBy && previous.message === report.message
  return same ? 'repeat' : 'insert'
}
