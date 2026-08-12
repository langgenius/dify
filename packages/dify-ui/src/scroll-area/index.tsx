'use client'

import { ScrollArea as BaseScrollArea } from '@base-ui/react/scroll-area'
import { cn } from '../cn'

const ScrollArea = BaseScrollArea.Root
type ScrollAreaProps = BaseScrollArea.Root.Props

const ScrollAreaContent = BaseScrollArea.Content
type ScrollAreaContentProps = BaseScrollArea.Content.Props

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
  'data-scrolling:bg-state-base-handle-hover',
  'active:bg-state-base-handle-hover',
)

const scrollAreaViewportClassName = cn(
  'size-full min-h-0 min-w-0',
  'focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-state-accent-solid focus-visible:outline-solid',
)

const scrollAreaCornerClassName = 'bg-transparent'

type ScrollAreaViewportProps = Omit<BaseScrollArea.Viewport.Props, 'className'> & {
  className?: string
}

function ScrollAreaViewport({ className, ...props }: ScrollAreaViewportProps) {
  return (
    <BaseScrollArea.Viewport className={cn(scrollAreaViewportClassName, className)} {...props} />
  )
}

type ScrollAreaScrollbarProps = Omit<BaseScrollArea.Scrollbar.Props, 'className'> & {
  className?: string
}

function ScrollAreaScrollbar({ className, ...props }: ScrollAreaScrollbarProps) {
  return (
    <BaseScrollArea.Scrollbar
      data-dify-scrollbar=""
      className={cn(scrollAreaScrollbarClassName, className)}
      {...props}
    />
  )
}

type ScrollAreaThumbProps = Omit<BaseScrollArea.Thumb.Props, 'className'> & {
  className?: string
}

function ScrollAreaThumb({ className, ...props }: ScrollAreaThumbProps) {
  return <BaseScrollArea.Thumb className={cn(scrollAreaThumbClassName, className)} {...props} />
}

type ScrollAreaCornerProps = Omit<BaseScrollArea.Corner.Props, 'className'> & {
  className?: string
}

function ScrollAreaCorner({ className, ...props }: ScrollAreaCornerProps) {
  return <BaseScrollArea.Corner className={cn(scrollAreaCornerClassName, className)} {...props} />
}

export {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaCorner,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
}

export type {
  ScrollAreaContentProps,
  ScrollAreaCornerProps,
  ScrollAreaProps,
  ScrollAreaScrollbarProps,
  ScrollAreaThumbProps,
  ScrollAreaViewportProps,
}
