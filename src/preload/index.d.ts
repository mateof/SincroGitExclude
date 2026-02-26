export interface ElectronAPI {
  invoke: <T = unknown>(channel: string, ...args: unknown[]) => Promise<T>
  on: (channel: string, callback: (...args: unknown[]) => void) => () => void
  once: (channel: string, callback: (...args: unknown[]) => void) => void
  getPathForFile: (file: File) => string
  selectDirectory: () => Promise<string | null>
  selectFile: (filters?: Array<{ name: string; extensions: string[] }>) => Promise<string | null>
  saveFile: (defaultName: string) => Promise<string | null>
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}
