import type { FC, PointerEvent as ReactPointerEvent } from 'react'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Avatar from '@/app/components/base/avatar'
import { useAppContext } from '@/context/app-context'
import { MentionInput } from './mention-input'
import cn from '@/utils/classnames'

type CommentInputProps = {
  position: { x: number; y: number }
  onSubmit: (content: string, mentionedUserIds: string[]) => void
  onCancel: () => void
  onPositionChange?: (position: {
    pageX: number
    pageY: number
    elementX: number
    elementY: number
  }) => void
}

export const CommentInput: FC<CommentInputProps> = memo(({ position, onSubmit, onCancel, onPositionChange }) => {
  const [content, setContent] = useState('')
  const { t } = useTranslation()
  const { userProfile } = useAppContext()
  const dragStateRef = useRef<{
    pointerId: number | null
    startPointerX: number
    startPointerY: number
    startX: number
    startY: number
    active: boolean
  } & {
    endHandler?: (event: PointerEvent) => void
  }>({
    pointerId: null,
    startPointerX: 0,
    startPointerY: 0,
    startX: 0,
    startY: 0,
    active: false,
    endHandler: undefined,
  })

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onCancel()
      }
    }

    document.addEventListener('keydown', handleGlobalKeyDown, true)
    return () => {
      document.removeEventListener('keydown', handleGlobalKeyDown, true)
    }
  }, [onCancel])

  const handleMentionSubmit = useCallback((content: string, mentionedUserIds: string[]) => {
    onSubmit(content, mentionedUserIds)
    setContent('')
  }, [onSubmit])

  const handleDragPointerMove = useCallback((event: PointerEvent) => {
    const state = dragStateRef.current
    if (!state.active || (state.pointerId !== null && event.pointerId !== state.pointerId))
      return
    if (!onPositionChange)
      return
    event.preventDefault()
    const deltaX = event.clientX - state.startPointerX
    const deltaY = event.clientY - state.startPointerY
    onPositionChange({
      pageX: event.clientX,
      pageY: event.clientY,
      elementX: state.startX + deltaX,
      elementY: state.startY + deltaY,
    })
  }, [onPositionChange])

  const stopDragging = useCallback((event?: PointerEvent) => {
    const state = dragStateRef.current
    if (!state.active)
      return
    if (event && state.pointerId !== null && event.pointerId !== state.pointerId)
      return
    state.active = false
    state.pointerId = null
    window.removeEventListener('pointermove', handleDragPointerMove)
    if (state.endHandler) {
      window.removeEventListener('pointerup', state.endHandler)
      window.removeEventListener('pointercancel', state.endHandler)
      state.endHandler = undefined
    }
  }, [handleDragPointerMove])

  const handleDragPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0)
      return
    event.stopPropagation()
    event.preventDefault()
    if (!onPositionChange)
      return
    const endHandler = (pointerEvent: PointerEvent) => {
      stopDragging(pointerEvent)
    }
    dragStateRef.current = {
      pointerId: event.pointerId,
      startPointerX: event.clientX,
      startPointerY: event.clientY,
      startX: position.x,
      startY: position.y,
      active: true,
      endHandler,
    }
    window.addEventListener('pointermove', handleDragPointerMove, { passive: false })
    window.addEventListener('pointerup', endHandler)
    window.addEventListener('pointercancel', endHandler)
  }, [handleDragPointerMove, onPositionChange, position.x, position.y, stopDragging])

  useEffect(() => () => {
    stopDragging()
  }, [stopDragging])

  return (
    <div
      className="absolute z-[60] w-96"
      style={{
        left: position.x,
        top: position.y,
      }}
      data-comment-input
    >
      <div className="flex items-center gap-3">
        <div
          className="relative shrink-0 cursor-move"
          onPointerDown={handleDragPointerDown}
        >
          <div className="relative h-8 w-8 overflow-hidden rounded-br-full rounded-tl-full rounded-tr-full bg-primary-500">
            <div className="absolute inset-[2px] overflow-hidden rounded-br-full rounded-tl-full rounded-tr-full bg-components-panel-bg-blur">
              <div className="flex h-full w-full items-center justify-center">
                <div className="h-6 w-6 overflow-hidden rounded-full">
                  <Avatar
                    avatar={userProfile.avatar_url}
                    name={userProfile.name}
                    size={24}
                    className="h-full w-full"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
        <div
          className={cn(
            'relative z-10 flex-1 rounded-xl border border-components-chat-input-border bg-components-panel-bg-blur pb-[4px] shadow-md',
          )}
        >
          <div className='relative pl-[9px] pt-[4px]'>
            <MentionInput
              value={content}
              onChange={setContent}
              onSubmit={handleMentionSubmit}
              placeholder={t('workflow.comments.placeholder.add')}
              autoFocus
              className="relative"
            />
          </div>
        </div>
      </div>
    </div>
  )
})

CommentInput.displayName = 'CommentInput'
