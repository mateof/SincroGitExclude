/**
 * Clipboard copy that also works in web mode.
 *
 * `navigator.clipboard` only exists in a secure context, and a browser reaching
 * the app over plain `http://<lan-ip>:<port>` is not one: there the async API
 * is missing (or rejects) and the copy fails silently. The legacy
 * `execCommand('copy')` path still works over HTTP, so it is used as fallback
 * and the caller is told whether anything actually reached the clipboard.
 */
export async function copyText(value: string): Promise<boolean> {
  try {
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    // Permission denied or unavailable — fall through to the legacy path
  }
  return legacyCopy(value)
}

function legacyCopy(value: string): boolean {
  try {
    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.setAttribute('readonly', '')
    // Off-screen but still focusable: `display: none` would break the selection
    textarea.style.position = 'fixed'
    textarea.style.top = '-1000px'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    textarea.setSelectionRange(0, value.length)
    const copied = document.execCommand('copy')
    document.body.removeChild(textarea)
    return copied
  } catch {
    return false
  }
}
