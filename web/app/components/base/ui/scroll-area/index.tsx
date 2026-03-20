'use client'

import { ScrollArea as BaseScrollArea } from '@base-ui/react/scroll-area'
import * as React from 'react'
import { cn } from '@/utils/classnames'
import styles from './index.module.css'

export const ScrollAreaRoot = BaseScrollArea.Root
export type ScrollAreaRootProps = React.ComponentPropsWithRef<typeof BaseScrollArea.Root>

export const ScrollAreaContent = BaseScrollArea.Content
export type ScrollAreaContentProps = React.ComponentPropsWithRef<typeof BaseScrollArea.Content>

export type ScrollAreaSlotClassNames = {
  viewport?: string
  content?: string
  scrollbar?: string
}

export type ScrollAreaProps = Omit<ScrollAreaRootProps, 'children'> & {
  children: React.ReactNode
  orientation?: 'vertical' | 'horizontal'
  slotClassNames?: ScrollAreaSlotClassNames
  label?: string
  labelledBy?: string
}

export const scrollAreaScrollbarClassName = cn(
  styles.scrollbar,
  'flex touch-none select-none overflow-clip p-1 opacity-100 transition-opacity motion-reduce:transition-none',
  'pointer-events-none data-[hovering]:pointer-events-auto',
  'data-[scrolling]:pointer-events-auto',
  'data-[orientation=vertical]:absolute data-[orientation=vertical]:inset-y-0 data-[orientation=vertical]:w-3 data-[orientation=vertical]:justify-center',
  'data-[orientation=horizontal]:absolute data-[orientation=horizontal]:inset-x-0 data-[orientation=horizontal]:h-3 data-[orientation=horizontal]:items-center',
)

export const scrollAreaThumbClassName = cn(
  'shrink-0 rounded-[4px] bg-state-base-handle transition-[background-color] motion-reduce:transition-none',
  'data-[orientation=vertical]:w-1',
  'data-[orientation=horizontal]:h-1',
)

export const scrollAreaViewportClassName = cn(
  'size-full min-h-0 min-w-0 outline-none',
  'focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-components-input-border-hover',
)

export const scrollAreaCornerClassName = 'bg-transparent'

export type ScrollAreaViewportProps = React.ComponentPropsWithRef<typeof BaseScrollArea.Viewport>

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

export type ScrollAreaScrollbarProps = React.ComponentPropsWithRef<typeof BaseScrollArea.Scrollbar>

export function ScrollAreaScrollbar({
  className,
  ...props
}: ScrollAreaScrollbarProps) {
  return (
    <BaseScrollArea.Scrollbar
      className={cn(scrollAreaScrollbarClassName, className)}
      {...props}
    />
  )
}

export type ScrollAreaThumbProps = React.ComponentPropsWithRef<typeof BaseScrollArea.Thumb>

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

export type ScrollAreaCornerProps = React.ComponentPropsWithRef<typeof BaseScrollArea.Corner>

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
