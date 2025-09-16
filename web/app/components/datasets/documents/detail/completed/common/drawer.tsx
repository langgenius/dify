import React, { useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import cn from '@/utils/classnames'
import { useKeyPress } from 'ahooks'
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
    if (!open) return
    e.preventDefault()
    onClose()
  }, { exactMatch: true, useCapture: true })

  const shouldCloseDrawer = useCallback((target: Node | null) => {
    const panelContent = panelContentRef.current
    if (!panelContent) return false
    const chunks = document.querySelectorAll('.chunk-card')
    const childChunks = document.querySelectorAll('.child-chunk')
    const isClickOnChunk = Array.from(chunks).some((chunk) => {
      return chunk && chunk.contains(target)
    })
    const isClickOnChildChunk = Array.from(childChunks).some((chunk) => {
      return chunk && chunk.contains(target)
    })
    const reopenChunkDetail = (currSegment.showModal && isClickOnChildChunk)
      || (currChildChunk.showModal && isClickOnChunk && !isClickOnChildChunk) || (!isClickOnChunk && !isClickOnChildChunk)
    return target && !panelContent.contains(target) && (!needCheckChunks || reopenChunkDetail)
  }, [currSegment, currChildChunk, needCheckChunks])

  const onDownCapture = useCallback((e: PointerEvent) => {
    if (!open || modal) return
    const panelContent = panelContentRef.current
    if (!panelContent) return
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

  const content = (
    <div className='pointer-events-none fixed inset-0 z-[9999]'>
      {showOverlay ? (
        <div
          onClick={modal ? onClose : undefined}
          aria-hidden='true'
          className={cn(
            'fixed inset-0 bg-black/30 opacity-0 transition-opacity duration-200 ease-in',
            open && 'opacity-100',
            modal && open ? 'pointer-events-auto' : 'pointer-events-none',
          )}
        />
      ) : null}

      {/* Drawer panel */}
      <div
        role='dialog'
        aria-modal={modal ? 'true' : 'false'}
        className={cn(
          'pointer-events-auto fixed flex flex-col',
          side === 'right' && 'right-0',
          side === 'left' && 'left-0',
          side === 'bottom' && 'bottom-0',
          side === 'top' && 'top-0',
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

  return open && createPortal(content, document.body)
}

export default Drawer
