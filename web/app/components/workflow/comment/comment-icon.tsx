'use client'

import type { WorkflowCommentBasic } from '@dify/contracts/api/console/apps/types.gen'
import type { FC, PointerEvent as ReactPointerEvent } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useSuspenseQuery } from '@tanstack/react-query'
import { memo, useCallback, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useReactFlow, useViewport } from 'reactflow'
import { UserAvatarList } from '@/app/components/base/user-avatar-list'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { getKeyboardMovement } from '../utils/keyboard-movement'
import CommentPreview from './comment-preview'

type CommentIconProps = {
  comment: WorkflowCommentBasic
  onClick: () => void
  isActive?: boolean
  onPositionUpdate?: (position: { x: number; y: number }) => void
}

export const CommentIcon: FC<CommentIconProps> = memo(
  ({ comment, onClick, isActive = false, onPositionUpdate }) => {
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
          if (onPositionUpdate) {
            const flowPosition = screenToFlowPosition({
              x: finalScreenPosition.x,
              y: finalScreenPosition.y,
            })
            onPositionUpdate(flowPosition)
          }
        } else if (!isActive) {
          onClick()
        }
      },
      [
        dragPosition,
        finishDrag,
        isActive,
        onClick,
        onPositionUpdate,
        screenPosition,
        screenToFlowPosition,
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

    const participants = useMemo(() => {
      const list = comment.participants ?? []
      const author = comment.created_by_account
      if (!author) return [...list]
      const rest = list.filter((user) => user.id !== author.id)
      return [author, ...rest]
    }, [comment.created_by_account, comment.participants])

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
        <IconButton
          aria-label={t(($) => $['keyboard.openComment'], {
            name: comment.created_by_account?.name ?? '',
          })}
          aria-describedby={isAuthor && onPositionUpdate ? descriptionId : undefined}
          className="nokey absolute z-10 size-auto -translate-y-full rounded-[13.5px] rounded-es-[3px] p-0 hover:bg-transparent"
          style={{
            left: canvasPosition.x,
            top: canvasPosition.y,
          }}
          data-role="comment-marker"
          id={`workflow-comment-marker-${comment.id}`}
          {...pointerEventHandlers}
          onClick={(event) => {
            if (event.detail === 0 && !isActive) {
              finishKeyboardMove()
              onClick()
            }
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
        >
          <div
            className={cn(
              'flex min-h-7 min-w-7 items-center rounded-[13.5px] rounded-es-[3px] bg-components-panel-bg-blur p-[1.5px] shadow-lg backdrop-blur-[5px]',
              isActive
                ? 'border-[1.5px] border-components-option-card-option-selected-border'
                : 'border-[0.5px] border-components-panel-border',
              cursorClass,
            )}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            <UserAvatarList users={participants} maxVisible={2} size="sm" />
          </div>
        </IconButton>
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
                onClick()
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
      prevProps.onClick === nextProps.onClick &&
      prevProps.isActive === nextProps.isActive &&
      prevProps.onPositionUpdate === nextProps.onPositionUpdate
    )
  },
)

CommentIcon.displayName = 'CommentIcon'
