import { useKeyPress } from 'ahooks'
import * as React from 'react'
import { useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/utils/classnames'
import { useSegmentListContext } from '..'

type DrawerProps = {
  open: boolean
  onClose: () => void
  side?: 'right' | 'left' | 'bottom' | 'top'
  showOverlay?: boolean
  modal?: boolean // click outside event can pass through if modal is false
  closeOnOutsideClick?: boolean
  panelClassName?: string
  panelContentClassName?: string
  needCheckChunks?: boolean
}

const SIDE_POSITION_CLASS = {
  right: 'right-0',
  left: 'left-0',
  bottom: 'bottom-0',
  top: 'top-0',
} as const

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

const Drawer = ({
  open,
  onClose,
  side = 'right',
  showOverlay = true,
  modal = false,
  needCheckChunks = false,
  children,
  panelClassName,
  panelContentClassName,
}: React.PropsWithChildren<DrawerProps>) => {
  const panelContentRef = useRef<HTMLDivElement>(null)
  const currSegment = useSegmentListContext(s => s.currSegment)
  const currChildChunk = useSegmentListContext(s => s.currChildChunk)

  useKeyPress('esc', (e) => {
    if (!open)
      return
    e.preventDefault()
    onClose()
  }, { exactMatch: true, useCapture: true })

  const shouldCloseDrawer = useCallback((target: Node | null) => {
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
  }, [currSegment.showModal, currChildChunk.showModal, needCheckChunks])

  const onDownCapture = useCallback((e: PointerEvent) => {
    if (!open || modal)
      return
    const panelContent = panelContentRef.current
    if (!panelContent)
      return
    const target = e.target as Node | null
    if (shouldCloseDrawer(target))
      queueMicrotask(onClose)
  }, [shouldCloseDrawer, onClose, open, modal])

  useEffect(() => {
    window.addEventListener('pointerdown', onDownCapture, { capture: true })
    return () =>
      window.removeEventListener('pointerdown', onDownCapture, { capture: true })
  }, [onDownCapture])

  const isHorizontal = side === 'left' || side === 'right'

  const overlayPointerEvents = modal && open ? 'pointer-events-auto' : 'pointer-events-none'

  const content = (
    <div className="pointer-events-none fixed inset-0 z-[9999]">
      {showOverlay && (
        <div
          onClick={modal ? onClose : undefined}
          aria-hidden="true"
          className={cn(
            'fixed inset-0 bg-black/30 opacity-0 transition-opacity duration-200 ease-in',
            open && 'opacity-100',
            overlayPointerEvents,
          )}
        />
      )}
      <div
        role="dialog"
        aria-modal={modal ? 'true' : 'false'}
        className={cn(
          'pointer-events-auto fixed flex flex-col',
          SIDE_POSITION_CLASS[side],
          isHorizontal ? 'h-screen' : 'w-screen',
          panelClassName,
        )}
      >
        <div ref={panelContentRef} className={cn('flex grow flex-col', panelContentClassName)}>
          {children}
        </div>
      </div>
    </div>
  )

  if (!open)
    return null

  return createPortal(content, document.body)
}

export default Drawer
