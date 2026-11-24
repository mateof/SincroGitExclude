export type UpdateBlocker = 'platform' | 'development' | 'translocated' | 'disk-image' | 'not-writable'

export interface UpdateCapability {
  supported: boolean
  blocker: UpdateBlocker | null
}

export type UpdatePhase = 'idle' | 'downloading' | 'verifying' | 'ready' | 'installing'

export interface UpdateState {
  phase: UpdatePhase
  version: string | null
  received: number
  total: number
  installFailed: boolean
}
