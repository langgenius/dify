'use client'

import { useId, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

type Options<T> = {
  items: T[]
  onChange: (items: T[]) => void
  disabled?: boolean
  minIndex?: number
  getItemLabel?: (item: T, index: number) => string
}

type SortSession<T> = {
  source: T[]
  order: number[]
  origin: number
  minIndex: number
  label: string
}

export function useKeyboardSortable<T>({
  items,
  onChange,
  disabled = false,
  minIndex = 0,
  getItemLabel,
}: Options<T>) {
  const { t } = useTranslation('common')
  const descriptionId = useId()
  const [session, setSession] = useState<SortSession<T> | null>(null)
  const [message, setMessage] = useState('')
  const handlesRef = useRef(new Map<number, HTMLButtonElement>())
  const pendingFocusRef = useRef<number | null>(null)
  const current =
    session?.source === items && !disabled && session.minIndex === minIndex ? session : null
  const displayedItems = current ? current.order.map((index) => items[index]!) : items
  const activeIndex = current?.order.indexOf(current.origin) ?? -1

  // External edits or permission changes end the local preview without overwriting them.
  if (session && !current) {
    setSession(null)
    setMessage(
      t(($) => $['sort.cancelled'], {
        item: session.label,
        position: session.origin + 1,
        count: items.length,
      }),
    )
  }

  useLayoutEffect(() => {
    if (pendingFocusRef.current === null) return
    const handle = handlesRef.current.get(pendingFocusRef.current)
    handle?.focus()
    handle?.scrollIntoView?.({ block: 'nearest' })
    pendingFocusRef.current = null
  })

  const cancel = (restoreFocus: boolean) => {
    if (!current) return
    if (restoreFocus) pendingFocusRef.current = current.origin
    setSession(null)
    setMessage(
      t(($) => $['sort.cancelled'], {
        item: current.label,
        position: current.origin + 1,
        count: items.length,
      }),
    )
  }

  const toggle = (index: number) => {
    if (disabled || index < minIndex || items.length - minIndex < 2) return
    if (current) {
      pendingFocusRef.current = activeIndex
      setSession(null)
      setMessage(
        t(($) => $['sort.finished'], {
          item: current.label,
          position: activeIndex + 1,
          count: items.length,
        }),
      )
      if (current.order.some((original, position) => original !== position))
        onChange(displayedItems)
      return
    }
    const label =
      getItemLabel?.(items[index]!, index) || t(($) => $['sort.item'], { position: index + 1 })
    setSession({
      source: items,
      order: items.map((_, position) => position),
      origin: index,
      minIndex,
      label,
    })
    setMessage(
      t(($) => $['sort.started'], { item: label, position: index + 1, count: items.length }),
    )
  }

  const getHandleProps = (index: number) => ({
    type: 'button' as const,
    ref: (element: HTMLButtonElement | null) => {
      if (element) handlesRef.current.set(index, element)
      else handlesRef.current.delete(index)
    },
    'aria-label': t(($) => $['sort.handle'], {
      item:
        getItemLabel?.(displayedItems[index]!, index) ||
        t(($) => $['sort.item'], { position: index + 1 }),
    }),
    'aria-describedby': descriptionId,
    'aria-pressed': activeIndex === index,
    disabled: disabled || index < minIndex || items.length - minIndex < 2,
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
      // Virtual clicks support assistive technology without starting a sort after pointer dragging.
      if (event.detail === 0) toggle(index)
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        if (!event.repeat) toggle(index)
        return
      }
      if (!current || activeIndex !== index) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        cancel(true)
      } else if (event.key === 'Tab') {
        cancel(false)
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault()
        event.stopPropagation()
        const nextIndex = Math.max(
          minIndex,
          Math.min(items.length - 1, index + (event.key === 'ArrowUp' ? -1 : 1)),
        )
        if (nextIndex === index) return
        const order = [...current.order]
        const [moved] = order.splice(index, 1)
        order.splice(nextIndex, 0, moved!)
        pendingFocusRef.current = nextIndex
        setSession({ ...current, order })
        setMessage(
          t(($) => $['sort.moved'], {
            item: current.label,
            position: nextIndex + 1,
            count: items.length,
          }),
        )
      }
    },
    onKeyUp: (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
      }
    },
    onBlur: () => {
      if (pendingFocusRef.current === null) cancel(false)
    },
  })

  return {
    items: displayedItems,
    getHandleProps,
    getItemKey: (index: number) => current?.order[index] ?? index,
    isSorting: !!current,
    announcement: (
      <>
        <span id={descriptionId} className="sr-only">
          {t(($) => $['sort.instructions'])}
        </span>
        <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {message}
        </span>
      </>
    ),
  }
}
