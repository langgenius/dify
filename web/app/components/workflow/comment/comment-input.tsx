import type { FC, PointerEvent as ReactPointerEvent } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useSuspenseQuery } from '@tanstack/react-query'
import { memo, useCallback, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { useStore } from '../store'
import { getKeyboardMovement } from '../utils/keyboard-movement'
import { CommentComposerFrame } from './comment-composer'
import { CommentMarker } from './comment-marker'
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
    const visibleCanvasWidth = useStore(
      (state) => (state.workflowCanvasWidth ?? Infinity) - (state.rightPanelWidth ?? 0),
    )
    const opensLeft = position.x + 39 + 320 > visibleCanvasWidth && position.x - 12 - 320 >= 0
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
        className={cn('absolute z-40', disabled && 'pointer-events-none opacity-80')}
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
        <IconButton
          aria-label={t(($) => $['keyboard.moveDraftComment'], { ns: 'workflow' })}
          aria-describedby={moveDescriptionId}
          aria-pressed={keyboardMoving}
          disabled={disabled || !onPositionChange}
          className="absolute bottom-0 size-auto cursor-move rounded-[13.5px] rounded-es-[3px] p-0 hover:bg-transparent"
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
          <CommentMarker
            selected
            participants={[
              { id: userProfile.id, name: userProfile.name, avatarUrl: userProfile.avatar_url },
            ]}
          />
        </IconButton>
        <span id={moveDescriptionId} className="sr-only" aria-live="polite">
          {t(($) => $['keyboard.moveDraftHelp'], { ns: 'workflow' })}{' '}
          {t(($) => $['keyboard.position'], { ns: 'workflow', x: position.x, y: position.y })}
        </span>
        <CommentComposerFrame
          className="absolute z-10 w-80 shadow-lg"
          style={{ top: Math.max(-34, -position.y), ...(opensLeft ? { right: 12 } : { left: 39 }) }}
        >
          <MentionInput
            value={content}
            onChange={setContent}
            onSubmit={handleMentionSubmit}
            placeholder={t(($) => $['comments.placeholder.add'], { ns: 'workflowComments' })}
            autoFocus={autoFocus}
            disabled={disabled}
          />
        </CommentComposerFrame>
      </div>
    )
  },
)

CommentInput.displayName = 'CommentInput'
