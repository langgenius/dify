'use client'

import type { WorkflowCommentBasic } from '@dify/contracts/api/console/apps/types.gen'
import type { PopoverHandle } from '@langgenius/dify-ui/popover'
import type { FC, PointerEvent as ReactPointerEvent } from 'react'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useSuspenseQuery } from '@tanstack/react-query'
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useReactFlow, useViewport } from 'reactflow'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { getKeyboardMovement } from '../utils/keyboard-movement'
import { CommentMarker } from './comment-marker'
import CommentPreview from './comment-preview'
import { getCommentMarkerId } from './marker-id'
import { getCommentParticipants } from './participants'

type CommentIconProps = {
  comment: WorkflowCommentBasic
  /** The canvas's comment thread popover; the marker is one of its triggers. */
  threadHandle: PopoverHandle<unknown>
  isActive?: boolean
  /** Called with the marker's comment, so the canvas can pass one stable handler to all. */
  onPositionUpdate?: (commentId: string, position: { x: number; y: number }) => void
}

export const CommentIcon: FC<CommentIconProps> = memo(
  ({ comment, threadHandle, isActive = false, onPositionUpdate }) => {
    const markerId = getCommentMarkerId(comment.id)
    const { t } = useTranslation(['workflow'])
    const descriptionId = useId()
    const { flowToScreenPosition, screenToFlowPosition } = useReactFlow()
    const viewport = useViewport()
    const { data: currentUserId } = useSuspenseQuery({
      ...userProfileQueryOptions(),
      select: (data) => data.profile.id,
    })
    const isAuthor = comment.created_by_account?.id === currentUserId
    const [showPreview, setShowPreview] = useState(false)
    const previewOpen = showPreview && !isActive
    // The preview mounts when it opens and unmounts once its close animation finishes, so it
    // can animate both ways without every hovered marker keeping a hidden preview.
    const [previewMounted, setPreviewMounted] = useState(false)
    if (previewOpen && !previewMounted) setPreviewMounted(true)
    const previewRef = useRef<HTMLDivElement>(null)
    useEffect(() => {
      if (previewOpen || !previewMounted) return
      const element = previewRef.current
      let aborted = false
      const unmount = () => {
        if (!aborted) setPreviewMounted(false)
      }
      // As Base UI does: give the close transition a frame to register, wait for every
      // animation on the preview, and look again if one is replaced; reopening aborts.
      const waitForAnimations = () => {
        if (!element || typeof element.getAnimations !== 'function') return unmount()
        Promise.all(element.getAnimations().map((animation) => animation.finished)).then(
          unmount,
          () => {
            if (!aborted) waitForAnimations()
          },
        )
      }
      const frame = requestAnimationFrame(waitForAnimations)
      return () => {
        aborted = true
        cancelAnimationFrame(frame)
      }
    }, [previewOpen, previewMounted])
    const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null)
    const [isDragging, setIsDragging] = useState(false)
    const keyboardPositionRef = useRef<{ x: number; y: number } | null>(null)
    const dragEndedRef = useRef(false)
    const finishKeyboardMove = useCallback(() => {
      const position = keyboardPositionRef.current
      if (!position) return
      keyboardPositionRef.current = null
      setDragPosition(null)
      onPositionUpdate?.(comment.id, position)
    }, [comment.id, onPositionUpdate])
    const dragStateRef = useRef<{
      offsetX: number
      offsetY: number
      startX: number
      startY: number
      hasMoved: boolean
    } | null>(null)

    const workflowContainerRect =
      typeof document !== 'undefined'
        ? document.getElementById('workflow-container')?.getBoundingClientRect()
        : null
    const containerLeft = workflowContainerRect?.left ?? 0
    const containerTop = workflowContainerRect?.top ?? 0

    const screenPosition = useMemo(() => {
      return flowToScreenPosition({
        x: comment.position_x,
        y: comment.position_y,
      })
    }, [
      comment.position_x,
      comment.position_y,
      viewport.x,
      viewport.y,
      viewport.zoom,
      flowToScreenPosition,
    ])

    const effectiveScreenPosition = dragPosition ?? screenPosition
    const canvasPosition = useMemo(
      () => ({
        x: effectiveScreenPosition.x - containerLeft,
        y: effectiveScreenPosition.y - containerTop,
      }),
      [effectiveScreenPosition.x, effectiveScreenPosition.y, containerLeft, containerTop],
    )
    const cursorClass = useMemo(() => {
      if (!isAuthor) return 'cursor-pointer'
      if (isActive) return isDragging ? 'cursor-grabbing' : ''
      return isDragging ? 'cursor-grabbing' : 'cursor-pointer'
    }, [isActive, isAuthor, isDragging])

    const handlePointerDown = useCallback(
      (event: ReactPointerEvent<HTMLElement>) => {
        if (event.button !== 0) return
        dragEndedRef.current = false

        event.stopPropagation()
        event.preventDefault()

        if (!isAuthor) {
          if (event.currentTarget.dataset.role !== 'comment-preview') setShowPreview(false)
          return
        }

        dragStateRef.current = {
          offsetX: event.clientX - screenPosition.x,
          offsetY: event.clientY - screenPosition.y,
          startX: event.clientX,
          startY: event.clientY,
          hasMoved: false,
        }

        setDragPosition(screenPosition)
        setIsDragging(false)

        if (event.currentTarget.dataset.role !== 'comment-preview') setShowPreview(false)

        if (event.currentTarget.setPointerCapture)
          event.currentTarget.setPointerCapture(event.pointerId)
      },
      [isAuthor, screenPosition],
    )

    const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
      const dragState = dragStateRef.current
      if (!dragState) return

      event.stopPropagation()
      event.preventDefault()

      const nextX = event.clientX - dragState.offsetX
      const nextY = event.clientY - dragState.offsetY

      if (!dragState.hasMoved) {
        const distance = Math.hypot(
          event.clientX - dragState.startX,
          event.clientY - dragState.startY,
        )
        if (distance > 4) {
          dragState.hasMoved = true
          setIsDragging(true)
        }
      }

      setDragPosition({ x: nextX, y: nextY })
    }, [])

    const finishDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
      const dragState = dragStateRef.current
      if (!dragState) return false

      if (event.currentTarget.hasPointerCapture?.(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId)

      dragStateRef.current = null
      setDragPosition(null)
      setIsDragging(false)
      return dragState.hasMoved
    }, [])

    const handlePointerUp = useCallback(
      (event: ReactPointerEvent<HTMLElement>) => {
        event.stopPropagation()
        event.preventDefault()

        const finalScreenPosition = dragPosition ?? screenPosition
        const didDrag = finishDrag(event)

        setShowPreview(false)

        if (didDrag) {
          // Only a drag on the marker itself is followed by a click on it to swallow.
          dragEndedRef.current = event.currentTarget.dataset.role === 'comment-marker'
          if (onPositionUpdate) {
            const flowPosition = screenToFlowPosition({
              x: finalScreenPosition.x,
              y: finalScreenPosition.y,
            })
            onPositionUpdate(comment.id, flowPosition)
          }
        } else if (event.currentTarget.dataset.role === 'comment-preview' && !isActive) {
          threadHandle.open(markerId)
        }
      },
      [
        comment.id,
        dragPosition,
        finishDrag,
        isActive,
        markerId,
        onPositionUpdate,
        screenPosition,
        screenToFlowPosition,
        threadHandle,
      ],
    )

    const handlePointerCancel = useCallback(
      (event: ReactPointerEvent<HTMLElement>) => {
        event.stopPropagation()
        event.preventDefault()
        finishDrag(event)
      },
      [finishDrag],
    )

    // A preview dismissed with Escape while the pointer is on it stays closed until the
    // pointer leaves the marker; otherwise the marker under the pointer would reopen it.
    const pointerOverRef = useRef(false)
    const dismissedRef = useRef(false)
    const openPreview = useCallback(() => {
      if (isActive || isDragging || dismissedRef.current) return
      setShowPreview(true)
    }, [isActive, isDragging])
    const handleMouseEnter = useCallback(() => {
      pointerOverRef.current = true
      openPreview()
    }, [openPreview])

    // Content shown on hover can be dismissed without moving the pointer (WCAG 1.4.13).
    useEffect(() => {
      if (!previewOpen) return
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return
        dismissedRef.current = pointerOverRef.current
        setShowPreview(false)
      }
      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
    }, [previewOpen])

    const handleMouseLeave = useCallback(() => {
      pointerOverRef.current = false
      dismissedRef.current = false
      setShowPreview(false)
    }, [])

    const participants = useMemo(
      () => getCommentParticipants(comment, currentUserId),
      [comment, currentUserId],
    )

    const pointerEventHandlers = useMemo(
      () => ({
        onPointerDown: handlePointerDown,
        onPointerMove: handlePointerMove,
        onPointerUp: handlePointerUp,
        onPointerCancel: handlePointerCancel,
      }),
      [handlePointerCancel, handlePointerDown, handlePointerMove, handlePointerUp],
    )

    return (
      <>
        <PopoverTrigger
          handle={threadHandle}
          id={markerId}
          render={
            <IconButton
              aria-label={t(($) => $['keyboard.openComment'], {
                name: comment.created_by_account?.name ?? '',
              })}
              className="nokey absolute z-10 size-auto -translate-y-full rounded-[13.5px] rounded-es-[3px] p-0 hover:bg-transparent"
            >
              <CommentMarker
                participants={participants}
                selected={isActive}
                className={cursorClass}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
              />
            </IconButton>
          }
          aria-describedby={isAuthor && onPositionUpdate ? descriptionId : undefined}
          style={{
            left: canvasPosition.x,
            top: canvasPosition.y,
          }}
          data-role="comment-marker"
          {...pointerEventHandlers}
          onClick={(event) => {
            if (dragEndedRef.current) {
              dragEndedRef.current = false
              event.preventBaseUIHandler()
              return
            }
            if (event.detail === 0) finishKeyboardMove()
          }}
          // Keyboard focus previews the comment like hovering does.
          onFocus={(event) => {
            if (event.currentTarget.matches(':focus-visible')) openPreview()
          }}
          onBlur={() => {
            finishKeyboardMove()
            dismissedRef.current = false
            setShowPreview(false)
          }}
          onKeyUp={(event) => {
            if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key))
              finishKeyboardMove()
          }}
          onKeyDown={(event) => {
            const delta = getKeyboardMovement(event)
            if (!delta || !isAuthor || !onPositionUpdate) return
            event.preventDefault()
            event.stopPropagation()
            // The preview sits over the marker; moving it should show where it goes.
            setShowPreview(false)
            const current = keyboardPositionRef.current ?? {
              x: comment.position_x,
              y: comment.position_y,
            }
            const next = { x: current.x + delta.x, y: current.y + delta.y }
            keyboardPositionRef.current = next
            setDragPosition(flowToScreenPosition(next))
          }}
        />
        {isAuthor && onPositionUpdate && (
          <span id={descriptionId} className="sr-only" aria-live="polite">
            {t(($) => $['keyboard.moveHelp'])}{' '}
            {t(($) => $['keyboard.position'], { x: comment.position_x, y: comment.position_y })}
          </span>
        )}

        {/* Preview panel */}
        {previewMounted && (
          <div
            data-open={previewOpen || undefined}
            ref={previewRef}
            className="absolute z-20 origin-bottom-left -translate-y-full transition-[opacity,scale,visibility] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] not-data-open:invisible not-data-open:opacity-0 not-data-open:duration-100 motion-safe:not-data-open:scale-95 starting:opacity-0 motion-safe:starting:scale-95"
            style={{
              left: canvasPosition.x,
              top: canvasPosition.y,
            }}
            data-role="comment-preview"
            {...pointerEventHandlers}
            onMouseEnter={() => {
              pointerOverRef.current = true
              setShowPreview(true)
            }}
            onMouseLeave={() => {
              // Leaving the preview may land back on the marker, so the dismissal holds.
              pointerOverRef.current = false
              setShowPreview(false)
            }}
          >
            <CommentPreview
              comment={comment}
              onClick={() => {
                setShowPreview(false)
                threadHandle.open(markerId)
              }}
            />
          </div>
        )}
      </>
    )
  },
)

CommentIcon.displayName = 'CommentIcon'
