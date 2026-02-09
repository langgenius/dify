import { useCallback, useEffect, useRef } from 'react'

type UseDelayedClickOptions = {
  delay?: number
  onSingleClick: () => void
  onDoubleClick: () => void
}

/**
 * Hook to distinguish between single-click and double-click events.
 * Single-click is delayed to allow double-click detection.
 * Double-click cancels any pending single-click.
 */
export function useDelayedClick({
  delay = 200,
  onSingleClick,
  onDoubleClick,
}: UseDelayedClickOptions) {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Cleanup timeout on unmount to prevent state updates on unmounted components
  useEffect(() => {
    return () => {
      if (timeoutRef.current)
        clearTimeout(timeoutRef.current)
    }
  }, [])

  const handleClick = useCallback(() => {
    if (timeoutRef.current)
      clearTimeout(timeoutRef.current)

    timeoutRef.current = setTimeout(() => {
      onSingleClick()
      timeoutRef.current = null
    }, delay)
  }, [delay, onSingleClick])

  const handleDoubleClick = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    onDoubleClick()
  }, [onDoubleClick])

  return { handleClick, handleDoubleClick }
}
