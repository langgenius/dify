'use client'
import type { OffsetOptions, Placement } from '@floating-ui/react'
import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  size,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useMergeRefs,
  useRole,
} from '@floating-ui/react'

import * as React from 'react'
import { useCallback, useState } from 'react'
import { cn } from '@/utils/classnames'

export type PortalToFollowElemOptions = {
  /*
  * top, bottom, left, right
  * start, end. Default is middle
  * combine: top-start, top-end
  */
  placement?: Placement
  open?: boolean
  offset?: number | OffsetOptions
  onOpenChange?: (open: boolean) => void
  triggerPopupSameWidth?: boolean
}

export function usePortalToFollowElem({
  placement = 'bottom',
  open: controlledOpen,
  offset: offsetValue = 0,
  onOpenChange: setControlledOpen,
  triggerPopupSameWidth,
}: PortalToFollowElemOptions = {}) {
  const [localOpen, setLocalOpen] = useState(false)
  const open = controlledOpen ?? localOpen
  const handleOpenChange = useCallback((newOpen: boolean) => {
    setLocalOpen(newOpen)
    setControlledOpen?.(newOpen)
  }, [setControlledOpen, setLocalOpen])

  const data = useFloating({
    placement,
    open,
    onOpenChange: handleOpenChange,
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(offsetValue),
      flip({
        crossAxis: placement.includes('-'),
        fallbackAxisSideDirection: 'start',
        padding: 5,
      }),
      shift({ padding: 5 }),
      size({
        apply({ rects, elements, availableHeight }) {
          Object.assign(elements.floating.style, {
            maxHeight: `${Math.max(0, availableHeight)}px`,
            overflowY: 'auto',
            ...(triggerPopupSameWidth && { width: `${rects.reference.width}px` }),
          })
        },
      }),
    ],
  })

  const context = data.context

  const hover = useHover(context, {
    move: false,
    enabled: controlledOpen === undefined,
  })
  const focus = useFocus(context, {
    enabled: controlledOpen === undefined,
  })
  const dismiss = useDismiss(context)
  const role = useRole(context, { role: 'tooltip' })

  const interactions = useInteractions([hover, focus, dismiss, role])

  return React.useMemo(
    () => ({
      open,
      setOpen: handleOpenChange,
      ...interactions,
      ...data,
    }),
    [open, handleOpenChange, interactions, data],
  )
}

type ContextType = ReturnType<typeof usePortalToFollowElem> | null

const PortalToFollowElemContext = React.createContext<ContextType>(null)

export function usePortalToFollowElemContext() {
  const context = React.useContext(PortalToFollowElemContext)

  if (context == null)
    throw new Error('PortalToFollowElem components must be wrapped in <PortalToFollowElem />')

  return context
}

export function PortalToFollowElem({
  children,
  ...options
}: { children: React.ReactNode } & PortalToFollowElemOptions) {
  // This can accept any props as options, e.g. `placement`,
  // or other positioning options.
  const tooltip = usePortalToFollowElem(options)
  return (
    <PortalToFollowElemContext.Provider value={tooltip}>
      {children}
    </PortalToFollowElemContext.Provider>
  )
}

export const PortalToFollowElemTrigger = (
  {
    ref: propRef,
    children,
    asChild = false,
    ...props
  }: React.HTMLProps<HTMLElement> & { ref?: React.RefObject<HTMLElement | null>, asChild?: boolean },
) => {
  const context = usePortalToFollowElemContext()
  const childrenRef = (children as any).props?.ref
  const ref = useMergeRefs([context.refs.setReference, propRef, childrenRef])

  // `asChild` allows the user to pass any element as the anchor
  if (asChild && React.isValidElement(children)) {
    const childProps = (children.props ?? {}) as Record<string, unknown>
    return React.cloneElement(
      children,
      context.getReferenceProps({
        ref,
        ...props,
        ...childProps,
        'data-state': context.open ? 'open' : 'closed',
      } as React.HTMLProps<HTMLElement>),
    )
  }

  return (
    <div
      ref={ref}
      className={cn('inline-block', props.className)}
      // The user can style the trigger based on the state
      data-state={context.open ? 'open' : 'closed'}
      {...context.getReferenceProps(props)}
    >
      {children}
    </div>
  )
}
PortalToFollowElemTrigger.displayName = 'PortalToFollowElemTrigger'

export const PortalToFollowElemContent = (
  {
    ref: propRef,
    style,
    ...props
  }: React.HTMLProps<HTMLDivElement> & {
    ref?: React.RefObject<HTMLDivElement | null>
  },
) => {
  const context = usePortalToFollowElemContext()
  const ref = useMergeRefs([context.refs.setFloating, propRef])

  if (!context.open)
    return null

  const body = document.body

  return (
    <FloatingPortal root={body}>
      <div
        ref={ref}
        style={{
          ...context.floatingStyles,
          ...style,
          visibility: context.middlewareData.hide?.referenceHidden ? 'hidden' : 'visible',
        }}
        {...context.getFloatingProps(props)}
      />
    </FloatingPortal>
  )
}

PortalToFollowElemContent.displayName = 'PortalToFollowElemContent'
