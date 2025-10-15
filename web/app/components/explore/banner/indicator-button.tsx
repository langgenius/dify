import type { FC } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import cn from '@/utils/classnames'

type IndicatorButtonProps = {
  index: number
  selectedIndex: number
  isNextSlide: boolean
  autoplayDelay: number
  resetKey: number
  isPaused?: boolean
  onClick: () => void
}

const PROGRESS_MAX = 100
const DEGREES_PER_PERCENT = 3.6

export const IndicatorButton: FC<IndicatorButtonProps> = ({
  index,
  selectedIndex,
  isNextSlide,
  autoplayDelay,
  resetKey,
  isPaused = false,
  onClick,
}) => {
  const [progress, setProgress] = useState(0)
  const [isPageVisible, setIsPageVisible] = useState(true)
  const frameIdRef = useRef<number | undefined>(undefined)
  const startTimeRef = useRef(0)

  // Listen to page visibility changes
  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsPageVisible(!document.hidden)
    }
    setIsPageVisible(!document.hidden)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  useEffect(() => {
    if (!isNextSlide) {
      setProgress(0)
      if (frameIdRef.current)
        cancelAnimationFrame(frameIdRef.current)

      return
    }

    // reset and start new animation
    setProgress(0)
    startTimeRef.current = Date.now()

    const animate = () => {
      // Only continue animation when page is visible and not paused
      if (!document.hidden && !isPaused) {
        const now = Date.now()
        const elapsed = now - startTimeRef.current
        const newProgress = Math.min((elapsed / autoplayDelay) * PROGRESS_MAX, PROGRESS_MAX)
        setProgress(newProgress)

        if (newProgress < PROGRESS_MAX)
          frameIdRef.current = requestAnimationFrame(animate)
      }
      else {
        frameIdRef.current = requestAnimationFrame(animate)
      }
    }
    if (!document.hidden && !isPaused)
      frameIdRef.current = requestAnimationFrame(animate)

    return () => {
      if (frameIdRef.current)
        cancelAnimationFrame(frameIdRef.current)
    }
  }, [isNextSlide, autoplayDelay, resetKey, isPageVisible, isPaused])

  const isActive = index === selectedIndex

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onClick()
  }, [onClick])

  return (
    <button
      onClick={handleClick}
      className={cn(
        'system-2xs-semibold-uppercase relative flex h-[18px] w-[20px] items-center justify-center rounded-[7px] border border-divider-subtle p-[2px] text-center transition-colors',
        isActive
          ? 'bg-text-primary text-components-panel-on-panel-item-bg'
          : 'bg-components-panel-on-panel-item-bg text-text-tertiary hover:text-text-secondary',
      )}
    >
      {/* progress border for next slide */}
      {isNextSlide && !isActive && (
        <span
          key={resetKey}
          className="absolute inset-[-1px] rounded-[7px]"
          style={{
            background: `conic-gradient(
              from 0deg,
              var(--color-text-primary) ${progress * DEGREES_PER_PERCENT}deg,
              transparent ${progress * DEGREES_PER_PERCENT}deg
            )`,
            WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
            WebkitMaskComposite: 'xor',
            mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
            maskComposite: 'exclude',
            padding: '1px',
          }}
        />
      )}

      {/* number content */}
      <span className="relative z-10">
        {String(index + 1).padStart(2, '0')}
      </span>
    </button>
  )
}
