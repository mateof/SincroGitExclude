import type { SpaceChange } from './space-admin'

export type ApprovalAction = 'add' | 'clone' | 'update'
export type ApprovalWarning = 'uploads' | 'public' | 'creates'

export interface ApprovalRequest {
  action: ApprovalAction
  spaceName: string
  folder: string
  tokenName: string
  changes: SpaceChange[]
  warnings: ApprovalWarning[]
}

export interface DialogText {
  title: string
  message: string
  detail: string
  allow: string
  deny: string
}

export type AskPerson = (text: DialogText, signal: AbortSignal) => Promise<boolean>

const MAX_TEXT = 160
export const APPROVAL_TIMEOUT_MS = 110_000
export const DENIED_PAUSE_MS = 30_000

const TEXT = {
  es: {
    title: 'SincroGitExclude',
    message: {
      add: 'Un asistente quiere añadir un espacio de conocimiento',
      clone: 'Un asistente quiere clonar un espacio de conocimiento',
      update: 'Un asistente quiere cambiar el destino de un espacio'
    },
    space: 'Espacio',
    folder: 'Carpeta',
    token: 'Token MCP',
    nothing: 'nada',
    warnings: {
      uploads: 'Las notas de esta carpeta se subirán a ese destino.',
      public: 'ATENCIÓN: cualquiera puede leer ese repositorio sin iniciar sesión.',
      creates: 'Se creará la carpeta.'
    },
    ask: 'Permítelo solo si lo has pedido tú.',
    allow: 'Permitir',
    deny: 'No permitir'
  },
  en: {
    title: 'SincroGitExclude',
    message: {
      add: 'An assistant wants to add a knowledge space',
      clone: 'An assistant wants to clone a knowledge space',
      update: 'An assistant wants to change the destination of a space'
    },
    space: 'Space',
    folder: 'Folder',
    token: 'MCP token',
    nothing: 'nothing',
    warnings: {
      uploads: 'The notes of this folder will be uploaded to that destination.',
      public: 'WARNING: anyone can read that repository without signing in.',
      creates: 'The folder will be created.'
    },
    ask: 'Allow it only if you asked for it.',
    allow: 'Allow',
    deny: 'Do not allow'
  }
}

export function plain(value: string): string {
  const clean = value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, ' ').trim()
  return clean.length > MAX_TEXT ? `${clean.slice(0, MAX_TEXT / 2)}…${clean.slice(-MAX_TEXT / 2)}` : clean
}

export function describeRequest(request: ApprovalRequest, locale: string): DialogText {
  const t = locale.toLowerCase().startsWith('es') ? TEXT.es : TEXT.en
  const lines = [
    `${t.space}: ${plain(request.spaceName)}`,
    `${t.folder}: ${plain(request.folder)}`,
    `${t.token}: ${plain(request.tokenName)}`,
    '',
    ...request.changes.map((c) =>
      request.action === 'update' ? `${c.field}: ${c.from === null ? t.nothing : plain(c.from)} → ${plain(c.to)}` : `${c.field}: ${plain(c.to)}`
    ),
    '',
    ...request.warnings.map((w) => t.warnings[w]),
    t.ask
  ]
  return { title: t.title, message: t.message[request.action], detail: lines.join('\n'), allow: t.allow, deny: t.deny }
}

export class ApprovalGate {
  private busy = false
  private deniedUntil = 0

  constructor(
    private readonly ask: AskPerson,
    private readonly locale: () => string,
    private readonly now: () => number = Date.now,
    private readonly timeoutMs = APPROVAL_TIMEOUT_MS
  ) {}

  async require(request: ApprovalRequest): Promise<void> {
    if (this.busy) throw new Error('Another request is waiting for the person in the app window')
    if (this.now() < this.deniedUntil) throw new Error('The person has just refused a request. Ask them before trying again.')
    this.busy = true
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), this.timeoutMs)
    try {
      const allowed = await this.ask(describeRequest(request, this.locale()), abort.signal)
      if (abort.signal.aborted) throw new Error('Nobody answered the request in the app window in time')
      if (!allowed) {
        this.deniedUntil = this.now() + DENIED_PAUSE_MS
        throw new Error('The person did not allow it in the app window')
      }
    } finally {
      clearTimeout(timer)
      this.busy = false
    }
  }
}
