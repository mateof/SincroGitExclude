/**
 * Bridge between the non-React web API shim and the React picker modal.
 *
 * In web mode there are no native dialogs, so `window.api` has to open a React
 * component and wait for it. The shim cannot render React, so it pushes a
 * request through here and `RemotePickerHost` fulfils the promise.
 */

export type PickerMode = 'directory' | 'file' | 'files' | 'items' | 'save'

export interface PickerRequest {
  mode: PickerMode
  /** Folder to open on, when the caller knows one (e.g. the repo of a deployment) */
  defaultPath?: string
  /** Pre-filled filename, save mode only */
  defaultName?: string
}

/** Absolute paths on the server, or null when the user cancelled. */
export type PickerResult = string[] | null

type PickerHandler = (request: PickerRequest) => Promise<PickerResult>

let handler: PickerHandler | null = null

export function setPickerHandler(fn: PickerHandler | null): void {
  handler = fn
}

export async function requestPick(request: PickerRequest): Promise<PickerResult> {
  if (!handler) {
    // Host not mounted yet — treat as a cancelled dialog rather than hanging
    console.warn('Remote picker requested before the host mounted')
    return null
  }
  return handler(request)
}
