'use client'

import type { FC, PointerEvent as ReactPointerEvent } from 'react'
import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { useReactFlow, useViewport } from 'reactflow'
import { UserAvatarList } from '@/app/components/base/user-avatar-list'
import CommentPreview from './comment-preview'
import type { WorkflowCommentList } from '@/service/workflow-comment'
import { useAppContext } from '@/context/app-context'

type CommentIconProps = {
  comment: WorkflowCommentList
  onClick: () => void
  isActive?: boolean
  onPositionUpdate?: (position: { x: number; y: number }) => void
}

export const CommentIcon: FC<CommentIconProps> = memo(({ comment, onClick, isActive = false, onPositionUpdate }) => {
  const { flowToScreenPosition, screenToFlowPosition } = useReactFlow()
  const viewport = useViewport()
  const { userProfile } = useAppContext()
  const isAuthor = comment.created_by_account?.id === userProfile?.id
  const [showPreview, setShowPreview] = useState(false)
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const dragStateRef = useRef<{
    offsetX: number
    offsetY: number
    startX: number
    startY: number
    hasMoved: boolean
  } | null>(null)

  const workflowContainerRect = typeof document !== 'undefined'
    ? document.getElementById('workflow-container')?.getBoundingClientRect()
    : null
  const containerLeft = workflowContainerRect?.left ?? 0
  const containerTop = workflowContainerRect?.top ?? 0

  const screenPosition = useMemo(() => {
    return flowToScreenPosition({
      x: comment.position_x,
      y: comment.position_y,
    })
  }, [comment.position_x, comment.position_y, viewport.x, viewport.y, viewport.zoom, flowToScreenPosition])

  const effectiveScreenPosition = dragPosition ?? screenPosition
  const canvasPosition = useMemo(() => ({
    x: effectiveScreenPosition.x - containerLeft,
    y: effectiveScreenPosition.y - containerTop,
  }), [effectiveScreenPosition.x, effectiveScreenPosition.y, containerLeft, containerTop])
  const cursorClass = useMemo(() => {
    if (!isAuthor)
      return 'cursor-pointer'
    if (isActive)
      return isDragging ? 'cursor-grabbing' : ''
    return isDragging ? 'cursor-grabbing' : 'cursor-pointer'
  }, [isActive, isAuthor, isDragging])

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0)
      return

    event.stopPropagation()
    event.preventDefault()

    if (!isAuthor) {
      if (event.currentTarget.dataset.role !== 'comment-preview')
        setShowPreview(false)
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

    if (event.currentTarget.dataset.role !== 'comment-preview')
      setShowPreview(false)

    if (event.currentTarget.setPointerCapture)
      event.currentTarget.setPointerCapture(event.pointerId)
  }, [isAuthor, screenPosition])

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current
    if (!dragState)
      return

    event.stopPropagation()
    event.preventDefault()

    const nextX = event.clientX - dragState.offsetX
    const nextY = event.clientY - dragState.offsetY

    if (!dragState.hasMoved) {
      const distance = Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY)
      if (distance > 4) {
        dragState.hasMoved = true
        setIsDragging(true)
      }
    }

    setDragPosition({ x: nextX, y: nextY })
  }, [])

  const finishDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current
    if (!dragState)
      return false

    if (event.currentTarget.hasPointerCapture?.(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)

    dragStateRef.current = null
    setDragPosition(null)
    setIsDragging(false)
    return dragState.hasMoved
  }, [])

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
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
    }
    else if (!isActive) {
      onClick()
    }
  }, [dragPosition, finishDrag, isActive, onClick, onPositionUpdate, screenPosition, screenToFlowPosition])

  const handlePointerCancel = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation()
    event.preventDefault()
    finishDrag(event)
  }, [finishDrag])

  const handleMouseEnter = useCallback(() => {
    if (isActive || isDragging)
      return
    setShowPreview(true)
  }, [isActive, isDragging])

  const handleMouseLeave = useCallback(() => {
    setShowPreview(false)
  }, [])

  const participants = useMemo(() => {
    const list = comment.participants ?? []
    const author = comment.created_by_account
    if (!author)
      return [...list]
    const rest = list.filter(user => user.id !== author.id)
    return [author, ...rest]
  }, [comment.created_by_account, comment.participants])

  // Calculate dynamic width based on number of participants
  const participantCount = participants.length
  const maxVisible = Math.min(3, participantCount)
  const showCount = participantCount > 3
  const avatarSize = 24
  const avatarSpacing = 4 // -space-x-1 is about 4px overlap

  // Width calculation: first avatar + (additional avatars * (size - spacing)) + padding
  const dynamicWidth = Math.max(40, // minimum width
    8 + avatarSize + Math.max(0, (showCount ? 2 : maxVisible - 1)) * (avatarSize - avatarSpacing) + 8,
  )

  const pointerEventHandlers = useMemo(() => ({
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerCancel: handlePointerCancel,
  }), [handlePointerCancel, handlePointerDown, handlePointerMove, handlePointerUp])

  return (
    <>
      <div
        className="absolute z-10"
        style={{
          left: canvasPosition.x,
          top: canvasPosition.y,
          transform: 'translate(-50%, -50%)',
        }}
        data-role='comment-marker'
        {...pointerEventHandlers}
      >
        <div
          className={cursorClass}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <div
            className={'relative h-10 rounded-br-full rounded-tl-full rounded-tr-full'}
            style={{ width: dynamicWidth }}
          >
            <div className={`absolute inset-[6px] overflow-hidden rounded-br-full rounded-tl-full rounded-tr-full border bg-components-panel-bg transition-shadow ${
              isActive
                ? 'border-primary-500 ring-1 ring-primary-500'
                : 'border-components-panel-border'
            }`}>
              <div className="flex h-full w-full items-center justify-center px-1">
                <UserAvatarList
                  users={participants}
                  maxVisible={3}
                  size={24}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Preview panel */}
      {showPreview && !isActive && (
        <div
          className="absolute z-20"
          style={{
            left: (effectiveScreenPosition.x - containerLeft) - dynamicWidth / 2,
            top: (effectiveScreenPosition.y - containerTop) + 20,
            transform: 'translateY(-100%)',
          }}
          data-role='comment-preview'
          {...pointerEventHandlers}
          onMouseEnter={() => setShowPreview(true)}
          onMouseLeave={() => setShowPreview(false)}
        >
          <CommentPreview comment={comment} onClick={() => {
            setShowPreview(false)
            onClick()
          }} />
        </div>
      )}
    </>
  )
}, (prevProps, nextProps) => {
  return (
    prevProps.comment.id === nextProps.comment.id
    && prevProps.comment.position_x === nextProps.comment.position_x
    && prevProps.comment.position_y === nextProps.comment.position_y
    && prevProps.onClick === nextProps.onClick
    && prevProps.isActive === nextProps.isActive
    && prevProps.onPositionUpdate === nextProps.onPositionUpdate
  )
})

CommentIcon.displayName = 'CommentIcon'
