import { contextBridge, ipcRenderer, webUtils } from 'electron'

export interface ElectronAPI {
  invoke: <T = unknown>(channel: string, ...args: unknown[]) => Promise<T>
  on: (channel: string, callback: (...args: unknown[]) => void) => () => void
  once: (channel: string, callback: (...args: unknown[]) => void) => void
  getPathForFile: (file: File) => string
  selectDirectory: () => Promise<string | null>
  selectFile: (filters?: Array<{ name: string; extensions: string[] }>) => Promise<string | null>
  saveFile: (defaultName: string) => Promise<string | null>
}

const api: ElectronAPI = {
  invoke: <T = unknown>(channel: string, ...args: unknown[]): Promise<T> => {
    return ipcRenderer.invoke(channel, ...args)
  },

  on: (channel: string, callback: (...args: unknown[]) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]): void =>
      callback(...args)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },

  once: (channel: string, callback: (...args: unknown[]) => void): void => {
    ipcRenderer.once(channel, (_event, ...args) => callback(...args))
  },

  getPathForFile: (file: File): string => webUtils.getPathForFile(file),

  selectDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:select-directory'),

  selectFile: (filters?): Promise<string | null> =>
    ipcRenderer.invoke('dialog:select-file', filters),

  saveFile: (defaultName: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:save-file', defaultName)
}

contextBridge.exposeInMainWorld('api', api)
