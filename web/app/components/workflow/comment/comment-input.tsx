import type { FC, PointerEvent as ReactPointerEvent } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@langgenius/dify-ui/avatar'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useSuspenseQuery } from '@tanstack/react-query'
import { memo, useCallback, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { getAvatarInitial } from '@/utils/avatar'
import { getKeyboardMovement } from '../utils/keyboard-movement'
import { MentionInput } from './mention-input'

type CommentInputProps = {
  position: { x: number; y: number }
  onSubmit: (content: string, mentionedUserIds: string[]) => void
  onCancel: () => void
  autoFocus?: boolean
  disabled?: boolean
  onPositionChange?: (position: {
    pageX: number
    pageY: number
    elementX: number
    elementY: number
  }) => void
}

export const CommentInput: FC<CommentInputProps> = memo(
  ({ position, onSubmit, onCancel, autoFocus = true, disabled = false, onPositionChange }) => {
    const [content, setContent] = useState('')
    const [keyboardMoving, setKeyboardMoving] = useState(false)
    const moveDescriptionId = useId()
    const { t } = useTranslation(['workflow', 'workflowComments'])
    const { data: userProfile } = useSuspenseQuery({
      ...userProfileQueryOptions(),
      select: (data) => data.profile,
    })
    const dragStateRef = useRef<
      {
        pointerId: number | null
        startPointerX: number
        startPointerY: number
        startPageX: number
        startPageY: number
        startX: number
        startY: number
        active: boolean
      } & {
        endHandler?: (event: PointerEvent) => void
      }
    >({
      pointerId: null,
      startPointerX: 0,
      startPointerY: 0,
      startPageX: 0,
      startPageY: 0,
      startX: 0,
      startY: 0,
      active: false,
      endHandler: undefined,
    })

    const handleMentionSubmit = useCallback(
      (content: string, mentionedUserIds: string[]) => {
        onSubmit(content, mentionedUserIds)
        setContent('')
      },
      [onSubmit],
    )

    const handleDragPointerMove = useCallback(
      (event: PointerEvent) => {
        const state = dragStateRef.current
        if (!state.active || (state.pointerId !== null && event.pointerId !== state.pointerId))
          return
        if (!onPositionChange) return
        event.preventDefault()
        const deltaX = event.clientX - state.startPointerX
        const deltaY = event.clientY - state.startPointerY
        onPositionChange({
          pageX: state.startPageX + deltaX,
          pageY: state.startPageY + deltaY,
          elementX: state.startX + deltaX,
          elementY: state.startY + deltaY,
        })
      },
      [onPositionChange],
    )

    const stopDragging = useCallback(
      (event?: PointerEvent) => {
        const state = dragStateRef.current
        if (!state.active) return
        if (event && state.pointerId !== null && event.pointerId !== state.pointerId) return
        state.active = false
        state.pointerId = null
        window.removeEventListener('pointermove', handleDragPointerMove)
        if (state.endHandler) {
          window.removeEventListener('pointerup', state.endHandler)
          window.removeEventListener('pointercancel', state.endHandler)
          state.endHandler = undefined
        }
      },
      [handleDragPointerMove],
    )

    const handleDragPointerDown = useCallback(
      (event: ReactPointerEvent<HTMLElement>) => {
        if (event.button !== 0) return
        event.stopPropagation()
        event.preventDefault()
        if (!onPositionChange) return
        const endHandler = (pointerEvent: PointerEvent) => {
          stopDragging(pointerEvent)
        }
        const anchorRect = event.currentTarget.getBoundingClientRect()
        dragStateRef.current = {
          pointerId: event.pointerId,
          startPointerX: event.clientX,
          startPointerY: event.clientY,
          startPageX: anchorRect.left,
          startPageY: anchorRect.bottom,
          startX: position.x,
          startY: position.y,
          active: true,
          endHandler,
        }
        window.addEventListener('pointermove', handleDragPointerMove, { passive: false })
        window.addEventListener('pointerup', endHandler)
        window.addEventListener('pointercancel', endHandler)
      },
      [handleDragPointerMove, onPositionChange, position.x, position.y, stopDragging],
    )

    useEffect(
      () => () => {
        stopDragging()
      },
      [stopDragging],
    )

    return (
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- The comment surface handles bubbling Escape after its child editor handles mentions.
      <div
        className={cn(
          'absolute z-40 w-90 -translate-y-9',
          disabled && 'pointer-events-none opacity-80',
        )}
        style={{
          left: position.x,
          top: position.y,
        }}
        role="group"
        data-comment-input
        onKeyDown={(event) => {
          if (event.defaultPrevented || event.nativeEvent.isComposing || event.key !== 'Escape')
            return
          event.preventDefault()
          event.stopPropagation()
          onCancel()
        }}
      >
        <div className="flex items-start gap-3">
          <div className="shrink-0 py-1.5">
            <IconButton
              aria-label={t(($) => $['keyboard.moveDraftComment'], { ns: 'workflow' })}
              aria-describedby={moveDescriptionId}
              aria-pressed={keyboardMoving}
              disabled={disabled || !onPositionChange}
              className="size-auto cursor-move rounded-[13.5px] rounded-es-[3px] border-[1.5px] border-components-option-card-option-selected-border bg-components-panel-bg-blur p-[1.5px] shadow-lg backdrop-blur-[5px] hover:bg-components-panel-bg-blur"
              onPointerDown={handleDragPointerDown}
              onClick={(event) => {
                if (event.detail === 0) setKeyboardMoving((value) => !value)
              }}
              onBlur={() => setKeyboardMoving(false)}
              onKeyDown={(event) => {
                const delta = getKeyboardMovement(event)
                if (!delta || !keyboardMoving || disabled || !onPositionChange) return
                event.preventDefault()
                event.stopPropagation()
                const rect = event.currentTarget.getBoundingClientRect()
                onPositionChange({
                  pageX: rect.left + delta.x,
                  pageY: rect.bottom + delta.y,
                  elementX: position.x + delta.x,
                  elementY: position.y + delta.y,
                })
              }}
            >
              <Avatar size="sm" aria-hidden="true">
                <AvatarFallback>{getAvatarInitial(userProfile.name)}</AvatarFallback>
                <AvatarImage src={userProfile.avatar_url || undefined} alt="" />
              </Avatar>
            </IconButton>
          </div>
          <span id={moveDescriptionId} className="sr-only" aria-live="polite">
            {t(($) => $['keyboard.moveDraftHelp'], { ns: 'workflow' })}{' '}
            {t(($) => $['keyboard.position'], { ns: 'workflow', x: position.x, y: position.y })}
          </span>
          <div className="relative z-10 min-w-0 flex-1 rounded-xl border border-components-chat-input-border bg-components-panel-bg-blur p-1 shadow-lg backdrop-blur-[5px]">
            <MentionInput
              value={content}
              onChange={setContent}
              onSubmit={handleMentionSubmit}
              placeholder={t(($) => $['comments.placeholder.add'], { ns: 'workflowComments' })}
              autoFocus={autoFocus}
              disabled={disabled}
            />
          </div>
        </div>
      </div>
    )
  },
)

CommentInput.displayName = 'CommentInput'
