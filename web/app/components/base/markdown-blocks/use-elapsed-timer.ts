import { useEffect, useRef, useState } from 'react'

/**
 * Elapsed-time timer shared by the tagged-markdown `ThinkBlock` and the
 * stream-driven `ReasoningPanel`. Counts up every 100ms until `complete`
 * latches true, then freezes. Initializing complete=true (e.g. historical
 * conversations) never starts the timer.
 */
export const useElapsedTimer = (complete: boolean) => {
  const [startTime] = useState(() => Date.now())
  const [elapsedTime, setElapsedTime] = useState(0)
  // Latch completion so a transient flip back to "not complete" never restarts the timer.
  const completedRef = useRef(complete)
  if (complete) completedRef.current = true
  const isComplete = completedRef.current
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (isComplete) return

    timerRef.current = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTime) / 100) / 10)
    }, 100)

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [startTime, isComplete])

  return { elapsedTime, isComplete }
}
