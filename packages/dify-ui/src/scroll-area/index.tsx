'use client'

import { ScrollArea as BaseScrollArea } from '@base-ui/react/scroll-area'
import { cn } from '../cn'
import { resolveClassName } from '../internals/resolve-class-name'

type ScrollAreaProps = BaseScrollArea.Root.Props

function ScrollArea({ className, ...props }: ScrollAreaProps) {
  return (
    <BaseScrollArea.Root
      {...props}
      data-dify-scroll-area=""
      className={(state) => cn('isolate', resolveClassName(className, state))}
    />
  )
}

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

type ScrollAreaViewportProps = BaseScrollArea.Viewport.Props

function ScrollAreaViewport({ className, ...props }: ScrollAreaViewportProps) {
  return (
    <BaseScrollArea.Viewport
      {...props}
      data-dify-scroll-area-viewport=""
      className={(state) =>
        cn('isolate size-full rounded-[inherit] outline-none', resolveClassName(className, state))
      }
    />
  )
}

type ScrollAreaScrollbarProps = BaseScrollArea.Scrollbar.Props

function ScrollAreaScrollbar({ className, ...props }: ScrollAreaScrollbarProps) {
  return (
    <BaseScrollArea.Scrollbar
      {...props}
      data-dify-scroll-area-scrollbar=""
      className={(state) => cn(scrollAreaScrollbarClassName, resolveClassName(className, state))}
    />
  )
}

type ScrollAreaThumbProps = BaseScrollArea.Thumb.Props

function ScrollAreaThumb({ className, ...props }: ScrollAreaThumbProps) {
  return (
    <BaseScrollArea.Thumb
      className={(state) => cn(scrollAreaThumbClassName, resolveClassName(className, state))}
      {...props}
    />
  )
}

type ScrollAreaCornerProps = BaseScrollArea.Corner.Props

function ScrollAreaCorner({ className, ...props }: ScrollAreaCornerProps) {
  return (
    <BaseScrollArea.Corner
      className={(state) => cn('bg-transparent', resolveClassName(className, state))}
      {...props}
    />
  )
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
