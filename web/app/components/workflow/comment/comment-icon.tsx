'use client'

import type { WorkflowCommentBasic } from '@dify/contracts/api/console/apps/types.gen'
import type { PopoverHandle } from '@langgenius/dify-ui/popover'
import type { FC, PointerEvent as ReactPointerEvent } from 'react'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useSuspenseQuery } from '@tanstack/react-query'
import { memo, useCallback, useId, useMemo, useRef, useState } from 'react'
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
  onPositionUpdate?: (position: { x: number; y: number }) => void
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
    const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null)
    const [isDragging, setIsDragging] = useState(false)
    const keyboardPositionRef = useRef<{ x: number; y: number } | null>(null)
    const dragEndedRef = useRef(false)
    const finishKeyboardMove = useCallback(() => {
      const position = keyboardPositionRef.current
      if (!position) return
      keyboardPositionRef.current = null
      setDragPosition(null)
      onPositionUpdate?.(position)
    }, [onPositionUpdate])
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
          dragEndedRef.current = true
          if (onPositionUpdate) {
            const flowPosition = screenToFlowPosition({
              x: finalScreenPosition.x,
              y: finalScreenPosition.y,
            })
            onPositionUpdate(flowPosition)
          }
        } else if (event.currentTarget.dataset.role === 'comment-preview' && !isActive) {
          threadHandle.open(markerId)
        }
      },
      [
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

    const handleMouseEnter = useCallback(() => {
      if (isActive || isDragging) return
      setShowPreview(true)
    }, [isActive, isDragging])

    const handleMouseLeave = useCallback(() => {
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
          onBlur={finishKeyboardMove}
          onKeyUp={(event) => {
            if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key))
              finishKeyboardMove()
          }}
          onKeyDown={(event) => {
            const delta = getKeyboardMovement(event)
            if (!delta || !isAuthor || !onPositionUpdate) return
            event.preventDefault()
            event.stopPropagation()
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
        {showPreview && !isActive && (
          <div
            className="absolute z-20 -translate-y-full"
            style={{
              left: canvasPosition.x,
              top: canvasPosition.y,
            }}
            data-role="comment-preview"
            {...pointerEventHandlers}
            onMouseEnter={() => setShowPreview(true)}
            onMouseLeave={() => setShowPreview(false)}
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
  (prevProps, nextProps) => {
    return (
      prevProps.comment.id === nextProps.comment.id &&
      prevProps.comment.position_x === nextProps.comment.position_x &&
      prevProps.comment.position_y === nextProps.comment.position_y &&
      prevProps.threadHandle === nextProps.threadHandle &&
      prevProps.isActive === nextProps.isActive &&
      prevProps.onPositionUpdate === nextProps.onPositionUpdate
    )
  },
)

CommentIcon.displayName = 'CommentIcon'
