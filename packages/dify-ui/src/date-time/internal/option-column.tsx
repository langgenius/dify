'use client'

import { useStableCallback } from '@base-ui/utils/useStableCallback'
import { useTimeout } from '@base-ui/utils/useTimeout'
import * as React from 'react'
import { cn } from '../../cn'

type OptionColumnHandle = { settle: () => number }

type OptionColumnProps = {
  ref?: React.Ref<OptionColumnHandle>
  label: string
  normalizeDigits: (text: string) => string
  value: number
  options: { value: number; label: string }[]
  onValueChange: (value: number) => void
  onEscape?: () => void
  scrollRequest?: number
  focusOnMount?: boolean
}

function OptionColumn({
  ref: handleRef,
  label,
  normalizeDigits,
  value,
  options,
  onValueChange,
  focusOnMount,
  onEscape,
  scrollRequest = 0,
}: OptionColumnProps) {
  const ref = React.useRef<HTMLDivElement>(null)
  const id = React.useId()
  const selectedIndex = options.findIndex((option) => option.value === value)
  const tabbableIndex = Math.max(0, selectedIndex)
  const searchRef = React.useRef({ text: '', time: 0, startIndex: 0 })
  React.useEffect(() => {
    searchRef.current = { text: '', time: 0, startIndex: 0 }
  }, [normalizeDigits])
  const gestureRef = React.useRef({ active: false, moved: false, touching: false })
  const quietTimer = useTimeout()
  const cancelGesture = useStableCallback(() => {
    quietTimer.clear()
    gestureRef.current.active = false
    gestureRef.current.moved = false
  })

  function scrollToOption(option: HTMLElement, smooth = false) {
    const column = ref.current
    if (!column) return
    column.scrollTo({
      top: option.offsetTop,
      behavior:
        smooth &&
        !column.ownerDocument.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'smooth'
          : 'instant',
    })
  }
  function nearestOption() {
    const column = ref.current
    if (!column) return undefined
    return Array.from(column.querySelectorAll<HTMLElement>('[role="option"]')).reduce<
      HTMLElement | undefined
    >(
      (nearest, option) =>
        !nearest ||
        Math.abs(option.offsetTop - column.scrollTop) <
          Math.abs(nearest.offsetTop - column.scrollTop)
          ? option
          : nearest,
      undefined,
    )
  }
  React.useImperativeHandle(handleRef, () => ({
    settle() {
      const option =
        gestureRef.current.active && gestureRef.current.moved ? nearestOption() : undefined
      cancelGesture()
      if (option) {
        scrollToOption(option)
        return Number(option.dataset.optionValue)
      }
      return value
    },
  }))
  const finishGesture = React.useEffectEvent(() => {
    if (!gestureRef.current.active || gestureRef.current.touching) return
    const option = gestureRef.current.moved ? nearestOption() : undefined
    cancelGesture()
    if (!option) return
    const next = Number(option.dataset.optionValue)
    if (next !== value) onValueChange(next)
    if (ref.current?.contains(ref.current.ownerDocument.activeElement))
      option.focus({ preventScroll: true })
    scrollToOption(option, true)
  })
  const updateGesture = React.useEffectEvent(() => {
    const option = nearestOption()
    if (!option) return
    const next = Number(option.dataset.optionValue)
    if (next !== value) onValueChange(next)
  })
  React.useEffect(() => {
    const column = ref.current
    if (!column) return
    const supportsScrollEnd = 'onscrollend' in column
    function begin() {
      quietTimer.clear()
      if (!gestureRef.current.active) {
        gestureRef.current = {
          ...gestureRef.current,
          active: true,
          moved: false,
        }
      }
      quietTimer.start(150, () => {
        if (gestureRef.current.touching) return
        if (!gestureRef.current.moved) cancelGesture()
        else if (!supportsScrollEnd) finishGesture()
      })
    }
    function onWheel(event: WheelEvent) {
      if (!event.ctrlKey && event.deltaY !== 0) begin()
    }
    function onTouchStart() {
      gestureRef.current.touching = true
      begin()
    }
    function onTouchEnd() {
      gestureRef.current.touching = false
      if (!gestureRef.current.moved) cancelGesture()
      if (!supportsScrollEnd && gestureRef.current.moved) scheduleFinish()
    }
    function scheduleFinish() {
      quietTimer.clear()
      quietTimer.start(150, () => finishGesture())
    }
    function onScroll() {
      if (!gestureRef.current.active) return
      gestureRef.current.moved = true
      updateGesture()
      if (!supportsScrollEnd) scheduleFinish()
    }
    function onScrollEnd() {
      finishGesture()
    }
    column.addEventListener('wheel', onWheel, { passive: true })
    column.addEventListener('touchstart', onTouchStart, { passive: true })
    column.addEventListener('touchend', onTouchEnd, { passive: true })
    column.addEventListener('touchcancel', onTouchEnd, { passive: true })
    column.addEventListener('scroll', onScroll, { passive: true })
    if (supportsScrollEnd) column.addEventListener('scrollend', onScrollEnd)
    return () => {
      cancelGesture()
      column.removeEventListener('wheel', onWheel)
      column.removeEventListener('touchstart', onTouchStart)
      column.removeEventListener('touchend', onTouchEnd)
      column.removeEventListener('touchcancel', onTouchEnd)
      column.removeEventListener('scroll', onScroll)
      column.removeEventListener('scrollend', onScrollEnd)
    }
  }, [cancelGesture, quietTimer])

  // Entry and Now are explicit positioning commands, never gesture-driven selections.
  React.useLayoutEffect(() => {
    cancelGesture()
    const column = ref.current
    const selected = column?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (selected && column) {
      column.scrollTo({
        top: selected.offsetTop,
        behavior: 'instant',
      })
    }
  }, [scrollRequest, cancelGesture])

  React.useEffect(() => {
    if (!focusOnMount) return
    const frame = requestAnimationFrame(() =>
      ref.current
        ?.querySelector<HTMLElement>('[aria-selected="true"]')
        ?.focus({ preventScroll: true }),
    )
    return () => cancelAnimationFrame(frame)
  }, [focusOnMount])

  function focusValue(next: number, smooth = false) {
    cancelGesture()
    onValueChange(next)
    const option = ref.current?.querySelector<HTMLElement>(`[data-option-value="${next}"]`)
    if (!option) return
    option.focus({ preventScroll: true })
    scrollToOption(option, smooth)
  }

  return (
    <div
      role="listbox"
      tabIndex={-1}
      aria-orientation="vertical"
      ref={ref}
      aria-label={label}
      className="relative flex h-full min-h-0 min-w-0 flex-1 scrollbar-none flex-col items-stretch gap-0.5 overflow-y-auto overscroll-none scroll-auto after:pointer-events-none after:h-[max(0px,calc(100%-1.625rem))] after:shrink-0 after:content-['']"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          searchRef.current = { text: '', time: 0, startIndex: 0 }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') cancelGesture()
        if (event.key === 'Escape' && onEscape) {
          event.preventDefault()
          event.stopPropagation()
          onEscape()
          return
        }
        if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return
        if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key))
          searchRef.current = { text: '', time: 0, startIndex: 0 }
        if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(event.key)) {
          event.preventDefault()
          event.stopPropagation()
          const currentOption =
            gestureRef.current.active && gestureRef.current.moved
              ? nearestOption()
              : (event.target as HTMLElement)
          const currentValue = Number(currentOption?.dataset.optionValue)
          const currentIndex = Math.max(
            0,
            options.findIndex((option) => option.value === currentValue),
          )
          const step = event.key.startsWith('Page') ? 5 : 1
          const delta = event.key.endsWith('Up') ? -step : step
          const nextIndex = Math.max(0, Math.min(options.length - 1, currentIndex + delta))
          const option = options[nextIndex]
          if (option) focusValue(option.value)
          return
        }
        if (event.key === 'Home' || event.key === 'End') {
          event.preventDefault()
          event.stopPropagation()
          const option = event.key === 'Home' ? options[0] : options.at(-1)
          if (option) focusValue(option.value)
        } else if (
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          !event.nativeEvent.isComposing &&
          Array.from(event.key).length === 1 &&
          event.key !== ' '
        ) {
          event.preventDefault()
          event.stopPropagation()
          const now = Date.now()
          const previous = searchRef.current
          let text = now - previous.time < 1000 ? previous.text : ''
          let startIndex = text ? previous.startIndex : tabbableIndex + 1
          const key = event.key.toLowerCase()
          // Repeated letters cycle; repeated digits must still form values such as 11 or 55.
          if (
            text === key &&
            !/^\d$/.test(normalizeDigits(key)) &&
            !options.some((option) => option.label.toLowerCase().startsWith(key + key))
          ) {
            text = ''
            startIndex = tabbableIndex + 1
          }
          text += key
          searchRef.current = { text, time: now, startIndex }
          const normalized = normalizeDigits(text)
          const numeric = /^\d+$/.test(normalized)
          let match = numeric
            ? options.find((option) => option.value === Number(normalized))
            : undefined
          if (!numeric) {
            for (let offset = 0; offset < options.length; offset++) {
              const option = options[(startIndex + offset) % options.length]!
              if (option.label.toLowerCase().startsWith(text)) {
                match = option
                break
              }
            }
          }
          if (match) focusValue(match.value)
          else if (!numeric) searchRef.current = { text: '', time: 0, startIndex: 0 }
        }
      }}
    >
      {options.map((option, index) => (
        <button
          key={option.value}
          id={`${id}-${option.value}`}
          type="button"
          role="option"
          aria-selected={option.value === value}
          tabIndex={index === tabbableIndex ? 0 : -1}
          data-option-value={option.value}
          onClick={(event) => focusValue(option.value, event.detail > 0)}
          className={cn(
            'aria-selected:bg-components-button-ghost-bg-hover',
            'flex min-h-6 shrink-0 items-center justify-center rounded-md px-1 system-xs-medium text-text-secondary tabular-nums hover:not-aria-selected:bg-state-base-hover-subtle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-state-accent-solid forced-colors:aria-selected:outline forced-colors:aria-selected:outline-[Highlight]',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export { OptionColumn }
export type { OptionColumnHandle }
