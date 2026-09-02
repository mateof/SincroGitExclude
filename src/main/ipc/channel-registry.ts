/**
 * Transport-agnostic registry of every IPC channel.
 *
 * Lives apart from `register-all.ts` so handler files can import `isWebEvent`
 * without creating an import cycle back into the module that registers them.
 */

export type ChannelHandler = (
  event: Electron.IpcMainInvokeEvent,
  ...args: unknown[]
) => unknown | Promise<unknown>

const channelRegistry = new Map<string, ChannelHandler>()

/**
 * Stand-in for the `IpcMainInvokeEvent` that Electron passes as first argument.
 *
 * Safe because no handler reads it: there is not a single reference to
 * `event.sender` or `IpcMainInvokeEvent` in `src/main/ipc/` outside the
 * registration wrapper. A handler that ever needs the sender must branch on
 * `isWebEvent(event)` instead of assuming a real Electron event.
 */
const NON_IPC_EVENT = { __transport: 'http' } as unknown as Electron.IpcMainInvokeEvent

/** Called by the `ipcMain.handle` wrapper in `register-all.ts`. */
export function registerChannel(channel: string, handler: ChannelHandler): void {
  channelRegistry.set(channel, handler)
}

export function isKnownChannel(channel: string): boolean {
  return channelRegistry.has(channel)
}

/**
 * Invoke a registered channel from outside Electron's IPC — currently the HTTP
 * server that backs browser clients (`src/main/server/`).
 *
 * Goes through the same wrapped listener as `ipcRenderer.invoke`, so logging,
 * error handling and the `{ success, data, error }` contract are identical
 * whichever transport the call arrived on.
 */
export async function invokeChannel<T = unknown>(
  channel: string,
  args: unknown[] = []
): Promise<T> {
  const handler = channelRegistry.get(channel)
  if (!handler) {
    throw new Error(`Unknown channel: ${channel}`)
  }
  return (await handler(NON_IPC_EVENT, ...args)) as T
}

/**
 * True when the call arrived over HTTP instead of Electron IPC.
 *
 * Handlers that would take down the process (anything calling `relaunchApp()`)
 * or stop the server out from under the caller must refuse web calls: the
 * browser client has no way to recover from either.
 */
export function isWebEvent(event: unknown): boolean {
  return (event as { __transport?: string } | null)?.__transport === 'http'
}
