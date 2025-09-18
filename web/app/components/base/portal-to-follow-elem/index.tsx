'use client'
import React, { useCallback, useMemo, useState } from 'react'
import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  size,
  useClick,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useMergeRefs,
  useRole,
} from '@floating-ui/react'

import type { OffsetOptions, Placement } from '@floating-ui/react'
import cn from '@/utils/classnames'
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
  const isControlled = controlledOpen !== undefined
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
        apply({ rects, elements }) {
          if (triggerPopupSameWidth)
            elements.floating.style.width = `${rects.reference.width}px`
        },
      }),
    ],
  })

  const context = data.context

  const hover = useHover(context, {
    move: false,
    enabled: !isControlled,
  })
  const focus = useFocus(context, {
    enabled: !isControlled,
  })
  const dismiss = useDismiss(context)
  const role = useRole(context, { role: 'tooltip' })

  const click = useClick(context)

  const interactionsArray = useMemo(() => {
    const result = [hover, focus, dismiss, role]

    if (!isControlled)
      result.push(click)
    return result
  }, [isControlled, hover, focus, dismiss, role, click])
  const interactions = useInteractions(interactionsArray)

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
  }: React.HTMLProps<HTMLElement> & { ref?: React.RefObject<HTMLElement>, asChild?: boolean },
) => {
  const context = usePortalToFollowElemContext()
  const childrenRef = (children as any).props?.ref
  const ref = useMergeRefs([context.refs.setReference, propRef, childrenRef])

  // `asChild` allows the user to pass any element as the anchor
  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(
      children,
      context.getReferenceProps({
        ref,
        ...props,
        ...children.props,
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
    ref?: React.RefObject<HTMLDivElement>;
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
