import type { OffsetOptions, Placement } from '@floating-ui/react'
import {
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from '@floating-ui/react'
import { useEffect, useMemo, useRef } from 'react'

export type Position = {
  x: number
  y: number
}

export type UseContextMenuFloatingOptions = {
  open: boolean
  onOpenChange: (open: boolean) => void
  position: Position
  placement?: Placement
  offset?: number | OffsetOptions
}

export function useContextMenuFloating({
  open,
  onOpenChange,
  position,
  placement = 'bottom-start',
  offset: offsetValue = 0,
}: UseContextMenuFloatingOptions) {
  const onOpenChangeRef = useRef(onOpenChange)
  onOpenChangeRef.current = onOpenChange

  const data = useFloating({
    placement,
    open,
    onOpenChange,
    middleware: [
      offset(offsetValue),
      flip({
        crossAxis: placement.includes('-'),
        fallbackAxisSideDirection: 'start',
        padding: 5,
      }),
      shift({ padding: 5 }),
    ],
  })

  const { context, refs, floatingStyles, isPositioned } = data

  useEffect(() => {
    refs.setPositionReference({
      getBoundingClientRect: () => ({
        width: 0,
        height: 0,
        x: position.x,
        y: position.y,
        top: position.y,
        left: position.x,
        right: position.x,
        bottom: position.y,
      }),
    })
  }, [position.x, position.y, refs])

  useEffect(() => {
    if (!open)
      return
    const handler = () => onOpenChangeRef.current(false)
    window.addEventListener('scroll', handler, { capture: true, passive: true })
    return () => window.removeEventListener('scroll', handler, { capture: true })
  }, [open])

  const dismiss = useDismiss(context)
  const role = useRole(context, { role: 'menu' })
  const interactions = useInteractions([dismiss, role])

  return useMemo(
    () => ({
      refs: {
        setFloating: refs.setFloating,
      },
      floatingStyles,
      getFloatingProps: interactions.getFloatingProps,
      context,
      isPositioned,
    }),
    [context, floatingStyles, isPositioned, refs.setFloating, interactions.getFloatingProps],
  )
}
