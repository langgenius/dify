'use client'

import type { ReactNode } from 'react'
import { ScrollArea as BaseScrollArea } from '@base-ui/react/scroll-area'
import { cn } from '@langgenius/dify-ui/cn'

export const ScrollAreaRoot = BaseScrollArea.Root
type ScrollAreaRootProps = BaseScrollArea.Root.Props

export const ScrollAreaContent = BaseScrollArea.Content

type ScrollAreaSlotClassNames = {
  viewport?: string
  content?: string
  scrollbar?: string
}

type ScrollAreaProps = Omit<ScrollAreaRootProps, 'children'> & {
  children: ReactNode
  orientation?: 'vertical' | 'horizontal'
  slotClassNames?: ScrollAreaSlotClassNames
  label?: string
  labelledBy?: string
}

const scrollAreaScrollbarClassName = cn(
  'group/scrollbar flex touch-none overflow-clip p-1 opacity-100 transition-opacity select-none motion-reduce:transition-none',
  'pointer-events-none data-hovering:pointer-events-auto',
  'data-scrolling:pointer-events-auto',
  'data-[orientation=vertical]:absolute data-[orientation=vertical]:inset-y-0 data-[orientation=vertical]:w-3 data-[orientation=vertical]:justify-center',
  'data-[orientation=horizontal]:absolute data-[orientation=horizontal]:inset-x-0 data-[orientation=horizontal]:h-3 data-[orientation=horizontal]:items-center',
)

const scrollAreaThumbClassName = cn(
  'shrink-0 rounded-sm bg-state-base-handle transition-[background-color] motion-reduce:transition-none',
  'data-[orientation=vertical]:w-1',
  'data-[orientation=horizontal]:h-1',
  'group-data-hovering/scrollbar:bg-state-base-handle-hover',
  'group-data-scrolling/scrollbar:bg-state-base-handle-hover',
  'active:bg-state-base-handle-hover',
)

const scrollAreaViewportClassName = cn(
  'size-full min-h-0 min-w-0 outline-hidden',
  'focus-visible:ring-1 focus-visible:ring-components-input-border-hover focus-visible:ring-inset',
)

const scrollAreaCornerClassName = 'bg-transparent'

type ScrollAreaViewportProps = BaseScrollArea.Viewport.Props

export function ScrollAreaViewport({
  className,
  ...props
}: ScrollAreaViewportProps) {
  return (
    <BaseScrollArea.Viewport
      className={cn(scrollAreaViewportClassName, className)}
      {...props}
    />
  )
}

type ScrollAreaScrollbarProps = BaseScrollArea.Scrollbar.Props

export function ScrollAreaScrollbar({
  className,
  ...props
}: ScrollAreaScrollbarProps) {
  return (
    <BaseScrollArea.Scrollbar
      data-dify-scrollbar=""
      className={cn(scrollAreaScrollbarClassName, className)}
      {...props}
    />
  )
}

type ScrollAreaThumbProps = BaseScrollArea.Thumb.Props

export function ScrollAreaThumb({
  className,
  ...props
}: ScrollAreaThumbProps) {
  return (
    <BaseScrollArea.Thumb
      className={cn(scrollAreaThumbClassName, className)}
      {...props}
    />
  )
}

type ScrollAreaCornerProps = BaseScrollArea.Corner.Props

export function ScrollAreaCorner({
  className,
  ...props
}: ScrollAreaCornerProps) {
  return (
    <BaseScrollArea.Corner
      className={cn(scrollAreaCornerClassName, className)}
      {...props}
    />
  )
}

export function ScrollArea({
  children,
  className,
  orientation = 'vertical',
  slotClassNames,
  label,
  labelledBy,
  ...props
}: ScrollAreaProps) {
  return (
    <ScrollAreaRoot className={className} {...props}>
      <ScrollAreaViewport
        aria-label={label}
        aria-labelledby={labelledBy}
        className={slotClassNames?.viewport}
        role={label || labelledBy ? 'region' : undefined}
      >
        <ScrollAreaContent className={slotClassNames?.content}>
          {children}
        </ScrollAreaContent>
      </ScrollAreaViewport>
      <ScrollAreaScrollbar orientation={orientation} className={slotClassNames?.scrollbar}>
        <ScrollAreaThumb />
      </ScrollAreaScrollbar>
    </ScrollAreaRoot>
  )
}
