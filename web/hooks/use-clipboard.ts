'use client'
import { useCallback, useRef, useState } from 'react'
import { writeTextToClipboard } from '@/utils/clipboard'

/**
 * A clipboard hook that uses the project's writeTextToClipboard utility,
 * which includes a fallback for non-secure (HTTP) contexts.
 *
 * Drop-in replacement for foxact/use-clipboard with the same API surface
 * (copied, copy, reset) so existing components need minimal changes.
 */
export function useClipboard() {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const copy = useCallback((text: string) => {
    writeTextToClipboard(text).then(() => {
      setCopied(true)
      if (timerRef.current)
        clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setCopied(false), 2000)
    }).catch(() => {
      // silently fail – matches foxact behaviour
    })
  }, [])

  const reset = useCallback(() => {
    setCopied(false)
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  return { copied, copy, reset }
}
