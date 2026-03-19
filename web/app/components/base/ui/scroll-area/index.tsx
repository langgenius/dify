'use client'

import { ScrollArea as BaseScrollArea } from '@base-ui/react/scroll-area'
import * as React from 'react'
import { cn } from '@/utils/classnames'

export const ScrollArea = BaseScrollArea.Root
export type ScrollAreaRootProps = React.ComponentPropsWithRef<typeof BaseScrollArea.Root>

export const ScrollAreaContent = BaseScrollArea.Content
export type ScrollAreaContentProps = React.ComponentPropsWithRef<typeof BaseScrollArea.Content>

export const scrollAreaScrollbarClassName = cn(
  'flex touch-none select-none opacity-0 transition-opacity motion-reduce:transition-none',
  'pointer-events-none data-[hovering]:pointer-events-auto data-[hovering]:opacity-100',
  'data-[scrolling]:pointer-events-auto data-[scrolling]:opacity-100',
  'hover:pointer-events-auto hover:opacity-100',
  'data-[orientation=vertical]:absolute data-[orientation=vertical]:inset-y-0 data-[orientation=vertical]:right-0 data-[orientation=vertical]:w-3 data-[orientation=vertical]:justify-center',
  'data-[orientation=horizontal]:absolute data-[orientation=horizontal]:inset-x-0 data-[orientation=horizontal]:bottom-0 data-[orientation=horizontal]:h-3 data-[orientation=horizontal]:items-center',
)

export const scrollAreaThumbClassName = cn(
  'shrink-0 rounded-[4px] bg-state-base-handle transition-[background-color] hover:bg-state-base-handle-hover motion-reduce:transition-none',
  'data-[orientation=vertical]:w-1',
  'data-[orientation=horizontal]:h-1',
)

export type ScrollAreaViewportProps = React.ComponentPropsWithRef<typeof BaseScrollArea.Viewport>

export function ScrollAreaViewport({
  className,
  ...props
}: ScrollAreaViewportProps) {
  return (
    <BaseScrollArea.Viewport
      className={cn('size-full min-h-0 min-w-0', className)}
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
      className={cn('bg-transparent', className)}
      {...props}
    />
  )
}
