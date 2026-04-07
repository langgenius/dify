'use client'

import { ScrollArea as BaseScrollArea } from '@base-ui/react/scroll-area'
import * as React from 'react'
import { cn } from '@/utils/classnames'
import styles from './index.module.css'

export const ScrollAreaRoot = BaseScrollArea.Root
type ScrollAreaRootProps = React.ComponentPropsWithRef<typeof BaseScrollArea.Root>

export const ScrollAreaContent = BaseScrollArea.Content

type ScrollAreaSlotClassNames = {
  viewport?: string
  content?: string
  scrollbar?: string
}

type ScrollAreaProps = Omit<ScrollAreaRootProps, 'children'> & {
  children: React.ReactNode
  orientation?: 'vertical' | 'horizontal'
  slotClassNames?: ScrollAreaSlotClassNames
  label?: string
  labelledBy?: string
}

const scrollAreaScrollbarClassName = cn(
  styles.scrollbar,
  'flex touch-none select-none overflow-clip p-1 opacity-100 transition-opacity motion-reduce:transition-none',
  'pointer-events-none data-hovering:pointer-events-auto',
  'data-scrolling:pointer-events-auto',
  'data-[orientation=vertical]:absolute data-[orientation=vertical]:inset-y-0 data-[orientation=vertical]:w-3 data-[orientation=vertical]:justify-center',
  'data-[orientation=horizontal]:absolute data-[orientation=horizontal]:inset-x-0 data-[orientation=horizontal]:h-3 data-[orientation=horizontal]:items-center',
)

const scrollAreaThumbClassName = cn(
  'shrink-0 radius-xs bg-state-base-handle transition-[background-color] motion-reduce:transition-none',
  'data-[orientation=vertical]:w-1',
  'data-[orientation=horizontal]:h-1',
)

const scrollAreaViewportClassName = cn(
  'size-full min-h-0 min-w-0 outline-hidden',
  'focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-components-input-border-hover',
)

const scrollAreaCornerClassName = 'bg-transparent'

type ScrollAreaViewportProps = React.ComponentPropsWithRef<typeof BaseScrollArea.Viewport>

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

type ScrollAreaScrollbarProps = React.ComponentPropsWithRef<typeof BaseScrollArea.Scrollbar>

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

type ScrollAreaThumbProps = React.ComponentPropsWithRef<typeof BaseScrollArea.Thumb>

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

type ScrollAreaCornerProps = React.ComponentPropsWithRef<typeof BaseScrollArea.Corner>

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
