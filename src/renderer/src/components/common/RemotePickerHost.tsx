import { useEffect, useRef, useState } from 'react'
import { RemotePathPicker } from './RemotePathPicker'
import {
  setPickerHandler,
  type PickerRequest,
  type PickerResult
} from '@/lib/remote-picker-bridge'
import { isWebMode } from '@/lib/web-api'

/**
 * Renders the remote file picker on demand for the web API shim.
 *
 * Mounted once at the app root. In Electron it registers nothing, because the
 * native dialogs are still in charge there.
 */
export function RemotePickerHost() {
  const [request, setRequest] = useState<PickerRequest | null>(null)
  const resolveRef = useRef<((result: PickerResult) => void) | null>(null)

  useEffect(() => {
    if (!isWebMode) return

    setPickerHandler((next) => {
      // A second dialog while one is open cancels the first, so its caller
      // never waits forever on a promise nobody will resolve.
      resolveRef.current?.(null)
      setRequest(next)
      return new Promise<PickerResult>((resolve) => {
        resolveRef.current = resolve
      })
    })

    return () => setPickerHandler(null)
  }, [])

  if (!request) return null

  const handleResolve = (result: PickerResult): void => {
    const resolve = resolveRef.current
    resolveRef.current = null
    setRequest(null)
    resolve?.(result)
  }

  return <RemotePathPicker request={request} onResolve={handleResolve} />
}
