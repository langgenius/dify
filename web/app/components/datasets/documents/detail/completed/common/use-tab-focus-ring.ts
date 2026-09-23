import { useEffect, useRef, useState } from 'react'

export function useTabFocusRing() {
  const [isTabFocused, setIsTabFocused] = useState(false)
  const tabFocusPendingRef = useRef(false)

  useEffect(() => {
    let clearPendingTimer: ReturnType<typeof setTimeout> | undefined

    const handleKeyDown = (event: KeyboardEvent) => {
      tabFocusPendingRef.current = event.key === 'Tab'
      if (clearPendingTimer) clearTimeout(clearPendingTimer)
      if (tabFocusPendingRef.current) {
        clearPendingTimer = setTimeout(() => {
          tabFocusPendingRef.current = false
        }, 0)
      }
    }
    const handlePointerDown = () => {
      tabFocusPendingRef.current = false
      setIsTabFocused(false)
    }

    document.addEventListener('keydown', handleKeyDown, true)
    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      document.removeEventListener('pointerdown', handlePointerDown, true)
      if (clearPendingTimer) clearTimeout(clearPendingTimer)
    }
  }, [])

  return {
    isTabFocused,
    onFocus: () => setIsTabFocused(tabFocusPendingRef.current),
    onBlur: () => setIsTabFocused(false),
  }
}
