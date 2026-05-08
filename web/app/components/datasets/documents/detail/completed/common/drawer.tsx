import type { ComponentProps, PropsWithChildren } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Drawer,
  DrawerBackdrop,
  DrawerContent,
  DrawerPopup,
  DrawerPortal,
  DrawerViewport,
} from '@langgenius/dify-ui/drawer'
import { useEffect, useRef } from 'react'
import { useSegmentListContext } from '..'

type DrawerSide = 'right' | 'left' | 'bottom' | 'top'
type DrawerSwipeDirection = 'right' | 'left' | 'down' | 'up'
type DrawerOpenChange = NonNullable<ComponentProps<typeof Drawer>['onOpenChange']>

type CompletedDrawerProps = {
  open: boolean
  onClose: () => void
  side?: DrawerSide
  showOverlay?: boolean
  modal?: boolean
  panelClassName?: string
  panelContentClassName?: string
  needCheckChunks?: boolean
}

const SIDE_TO_SWIPE_DIRECTION: Record<DrawerSide, DrawerSwipeDirection> = {
  right: 'right',
  left: 'left',
  bottom: 'down',
  top: 'up',
}

const DRAWER_SHELL_CLASS_NAME = [
  'pointer-events-auto overflow-visible border-0 bg-transparent shadow-none',
  'data-[swipe-direction=right]:h-screen data-[swipe-direction=right]:max-w-none data-[swipe-direction=right]:rounded-none data-[swipe-direction=right]:border-0',
  'data-[swipe-direction=left]:h-screen data-[swipe-direction=left]:max-w-none data-[swipe-direction=left]:rounded-none data-[swipe-direction=left]:border-0',
  'data-[swipe-direction=down]:max-h-none data-[swipe-direction=down]:rounded-none data-[swipe-direction=down]:border-0',
  'data-[swipe-direction=up]:max-h-none data-[swipe-direction=up]:rounded-none data-[swipe-direction=up]:border-0',
].join(' ')

function containsTarget(selector: string, target: Node | null): boolean {
  const elements = document.querySelectorAll(selector)
  return Array.from(elements).some(el => el?.contains(target))
}

function shouldReopenChunkDetail(
  isClickOnChunk: boolean,
  isClickOnChildChunk: boolean,
  segmentModalOpen: boolean,
  childChunkModalOpen: boolean,
): boolean {
  if (segmentModalOpen && isClickOnChildChunk)
    return true
  if (childChunkModalOpen && isClickOnChunk && !isClickOnChildChunk)
    return true
  return !isClickOnChunk && !isClickOnChildChunk
}

export function CompletedDrawer({
  open,
  onClose,
  side = 'right',
  showOverlay = true,
  modal = false,
  needCheckChunks = false,
  children,
  panelClassName,
  panelContentClassName,
}: PropsWithChildren<CompletedDrawerProps>) {
  const panelContentRef = useRef<HTMLDivElement>(null)
  const currSegment = useSegmentListContext(s => s.currSegment)
  const currChildChunk = useSegmentListContext(s => s.currChildChunk)

  useEffect(() => {
    if (!open || modal)
      return

    const shouldCloseDrawer = (target: Node | null) => {
      const panelContent = panelContentRef.current
      if (!panelContent || !target)
        return false

      if (panelContent.contains(target))
        return false

      if (containsTarget('.image-previewer', target))
        return false

      if (!needCheckChunks)
        return true

      const isClickOnChunk = containsTarget('.chunk-card', target)
      const isClickOnChildChunk = containsTarget('.child-chunk', target)
      return shouldReopenChunkDetail(isClickOnChunk, isClickOnChildChunk, currSegment.showModal, currChildChunk.showModal)
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (shouldCloseDrawer(event.target as Node | null))
        queueMicrotask(onClose)
    }

    window.addEventListener('pointerdown', handlePointerDown, { capture: true })
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, { capture: true })
    }
  }, [currChildChunk.showModal, currSegment.showModal, modal, needCheckChunks, onClose, open])

  const handleOpenChange: DrawerOpenChange = (nextOpen, eventDetails) => {
    if (nextOpen)
      return

    if (eventDetails.reason === 'focus-out' || eventDetails.reason === 'outside-press')
      return

    onClose()
  }

  if (!open)
    return null

  return (
    <Drawer
      open={open}
      modal={modal}
      swipeDirection={SIDE_TO_SWIPE_DIRECTION[side]}
      disablePointerDismissal
      onOpenChange={handleOpenChange}
    >
      <DrawerPortal>
        {showOverlay && (
          <DrawerBackdrop
            onClick={modal ? onClose : undefined}
            className={cn(
              'bg-black/30',
              !modal && 'pointer-events-none',
            )}
          />
        )}
        <DrawerViewport className="pointer-events-none">
          <DrawerPopup
            aria-modal={modal ? 'true' : 'false'}
            className={cn(DRAWER_SHELL_CLASS_NAME, panelClassName)}
          >
            <DrawerContent
              ref={panelContentRef}
              className={cn('flex grow flex-col overflow-visible p-0 pb-0', panelContentClassName)}
            >
              {children}
            </DrawerContent>
          </DrawerPopup>
        </DrawerViewport>
      </DrawerPortal>
    </Drawer>
  )
}
