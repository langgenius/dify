'use client'
import { useCallback, useRef, useState } from 'react'

const RESET_DELAY = 2000

/**
 * A robust clipboard hook that works in both secure (HTTPS/localhost)
 * and non-secure (HTTP) contexts.
 *
 * First tries navigator.clipboard.writeText (modern API),
 * falls back to document.execCommand('copy') via a temporary textarea
 * when the Clipboard API is unavailable or throws a SecurityError.
 *
 * API matches foxact/use-clipboard for drop-in replacement.
 */
export function useClipboard() {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const reset = useCallback(() => {
    setCopied(false)
    if (timerRef.current)
      clearTimeout(timerRef.current)
  }, [])

  const copy = useCallback((text: string) => {
    const onCopied = () => {
      setCopied(true)
      if (timerRef.current)
        clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setCopied(false), RESET_DELAY)
    }

    // Try modern Clipboard API first
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(onCopied).catch(() => {
        // Fallback for SecurityError or other failures
        fallbackCopyText(text, onCopied)
      })
      return
    }

    // No clipboard API at all — use fallback
    fallbackCopyText(text, onCopied)
  }, [])

  return { copied, copy, reset }
}

function fallbackCopyText(text: string, onSuccess: () => void) {
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    // Prevent scrolling to bottom and visual artifacts
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'absolute'
    textarea.style.left = '-9999px'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    if (ok)
      onSuccess()
  }
  catch {
    // Silently fail — nothing more we can do
  }
}
