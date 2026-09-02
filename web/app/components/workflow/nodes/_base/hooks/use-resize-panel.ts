import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export type UseResizePanelParams = {
  direction?: 'horizontal' | 'vertical' | 'both'
  triggerDirection?:
    | 'top'
    | 'right'
    | 'bottom'
    | 'left'
    | 'top-right'
    | 'top-left'
    | 'bottom-right'
    | 'bottom-left'
  minWidth?: number
  maxWidth?: number
  minHeight?: number
  maxHeight?: number
  currentWidth?: number
  currentHeight?: number
  keyboardStep?: number
  onResized?: (width: number, height: number) => void
  onResize?: (width: number, height: number) => void
}
export const useResizePanel = (params?: UseResizePanelParams) => {
  const {
    direction = 'both',
    triggerDirection = 'bottom-right',
    minWidth = -Infinity,
    maxWidth = Infinity,
    minHeight = -Infinity,
    maxHeight = Infinity,
    currentWidth,
    currentHeight,
    keyboardStep = 10,
    onResized,
    onResize,
  } = params || {}
  const triggerRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const initXRef = useRef(0)
  const initYRef = useRef(0)
  const initContainerWidthRef = useRef(0)
  const initContainerHeightRef = useRef(0)
  const isResizingRef = useRef(false)
  const [prevUserSelectStyle, setPrevUserSelectStyle] = useState(
    () => getComputedStyle(document.body).userSelect,
  )

  const handleStartResize = useCallback(
    (e: MouseEvent) => {
      initXRef.current = e.clientX
      initYRef.current = e.clientY
      initContainerWidthRef.current = containerRef.current?.offsetWidth || minWidth
      initContainerHeightRef.current = containerRef.current?.offsetHeight || minHeight
      isResizingRef.current = true
      setPrevUserSelectStyle(getComputedStyle(document.body).userSelect)
      document.body.style.userSelect = 'none'
    },
    [minWidth, minHeight],
  )

  const handleResize = useCallback(
    (e: MouseEvent) => {
      if (!isResizingRef.current) return

      if (!containerRef.current) return

      if (direction === 'horizontal' || direction === 'both') {
        const offsetX = e.clientX - initXRef.current
        let width = 0
        if (
          triggerDirection === 'left' ||
          triggerDirection === 'top-left' ||
          triggerDirection === 'bottom-left'
        )
          width = initContainerWidthRef.current - offsetX
        else if (
          triggerDirection === 'right' ||
          triggerDirection === 'top-right' ||
          triggerDirection === 'bottom-right'
        )
          width = initContainerWidthRef.current + offsetX

        if (width < minWidth) width = minWidth
        if (width > maxWidth) width = maxWidth
        containerRef.current.style.width = `${width}px`
        onResize?.(width, 0)
      }

      if (direction === 'vertical' || direction === 'both') {
        const offsetY = e.clientY - initYRef.current
        let height = 0
        if (
          triggerDirection === 'top' ||
          triggerDirection === 'top-left' ||
          triggerDirection === 'top-right'
        )
          height = initContainerHeightRef.current - offsetY
        else if (
          triggerDirection === 'bottom' ||
          triggerDirection === 'bottom-left' ||
          triggerDirection === 'bottom-right'
        )
          height = initContainerHeightRef.current + offsetY

        if (height < minHeight) height = minHeight
        if (height > maxHeight) height = maxHeight

        containerRef.current.style.height = `${height}px`
        onResize?.(0, height)
      }
    },
    [direction, triggerDirection, minWidth, maxWidth, minHeight, maxHeight, onResize],
  )

  const handleStopResize = useCallback(() => {
    isResizingRef.current = false
    document.body.style.userSelect = prevUserSelectStyle

    if (onResized && containerRef.current)
      onResized(containerRef.current.offsetWidth, containerRef.current.offsetHeight)
  }, [prevUserSelectStyle, onResized])

  const handleResizeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!containerRef.current) return

      const isHorizontalResize = direction === 'horizontal'
      const isVerticalResize = direction === 'vertical'
      if (!isHorizontalResize && !isVerticalResize) return

      const currentValue = isHorizontalResize
        ? (currentWidth ?? containerRef.current.offsetWidth)
        : (currentHeight ?? containerRef.current.offsetHeight)
      const minValue = isHorizontalResize ? minWidth : minHeight
      const maxValue = isHorizontalResize ? maxWidth : maxHeight
      const increaseKey = isHorizontalResize
        ? triggerDirection.includes('left')
          ? 'ArrowLeft'
          : 'ArrowRight'
        : triggerDirection.includes('top')
          ? 'ArrowUp'
          : 'ArrowDown'
      const decreaseKey = isHorizontalResize
        ? increaseKey === 'ArrowLeft'
          ? 'ArrowRight'
          : 'ArrowLeft'
        : increaseKey === 'ArrowUp'
          ? 'ArrowDown'
          : 'ArrowUp'

      let nextValue: number | undefined
      if (event.key === increaseKey)
        nextValue = currentValue + keyboardStep * (event.shiftKey ? 10 : 1)
      else if (event.key === decreaseKey)
        nextValue = currentValue - keyboardStep * (event.shiftKey ? 10 : 1)
      else if (event.key === 'Home' && Number.isFinite(minValue)) nextValue = minValue
      else if (event.key === 'End' && Number.isFinite(maxValue)) nextValue = maxValue

      if (nextValue === undefined) return

      event.preventDefault()
      nextValue = Math.min(Math.max(nextValue, minValue), maxValue)

      if (isHorizontalResize) {
        containerRef.current.style.width = `${nextValue}px`
        onResize?.(nextValue, 0)
      } else {
        containerRef.current.style.height = `${nextValue}px`
        onResize?.(0, nextValue)
      }
    },
    [
      currentHeight,
      currentWidth,
      direction,
      keyboardStep,
      maxHeight,
      maxWidth,
      minHeight,
      minWidth,
      onResize,
      triggerDirection,
    ],
  )

  const resizeHandleProps = useMemo(() => {
    const isHorizontalResize = direction === 'horizontal'
    const isVerticalResize = direction === 'vertical'
    if (!isHorizontalResize && !isVerticalResize) return {}

    const minValue = isHorizontalResize ? minWidth : minHeight
    const maxValue = isHorizontalResize ? maxWidth : maxHeight
    const currentValue = isHorizontalResize ? currentWidth : currentHeight

    return {
      role: 'separator' as const,
      tabIndex: 0,
      'aria-orientation': isHorizontalResize ? ('vertical' as const) : ('horizontal' as const),
      'aria-valuemin': Number.isFinite(minValue) ? minValue : undefined,
      'aria-valuemax': Number.isFinite(maxValue) ? maxValue : undefined,
      'aria-valuenow': currentValue,
      onKeyDown: handleResizeKeyDown,
    }
  }, [
    currentHeight,
    currentWidth,
    direction,
    handleResizeKeyDown,
    maxHeight,
    maxWidth,
    minHeight,
    minWidth,
  ])

  useEffect(() => {
    const element = triggerRef.current
    element?.addEventListener('mousedown', handleStartResize)
    document.addEventListener('mousemove', handleResize)
    document.addEventListener('mouseup', handleStopResize)
    return () => {
      if (element) element.removeEventListener('mousedown', handleStartResize)
      document.removeEventListener('mousemove', handleResize)
      document.removeEventListener('mouseup', handleStopResize)
    }
  }, [handleStartResize, handleResize, handleStopResize])

  return {
    triggerRef,
    containerRef,
    resizeHandleProps,
  }
}
