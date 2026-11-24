import { app, BrowserWindow, dialog } from 'electron'
import type { AskPerson } from './approval'

export const askInWindow: AskPerson = async (text, signal) => {
  const options = {
    type: 'warning' as const,
    title: text.title,
    message: text.message,
    detail: text.detail,
    buttons: [text.deny, text.allow],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    signal
  }
  const window = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
  app.focus({ steal: true })
  if (window) {
    window.show()
    return (await dialog.showMessageBox(window, options)).response === 1
  }
  return (await dialog.showMessageBox(options)).response === 1
}
