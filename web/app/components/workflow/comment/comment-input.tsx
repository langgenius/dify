import type { FC, KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import {
  Popover,
  PopoverPopup,
  PopoverPortal,
  PopoverPositioner,
} from '@langgenius/dify-ui/popover'
import { useSuspenseQuery } from '@tanstack/react-query'
import { memo, useCallback, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useReactFlow, useViewport } from 'reactflow'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { getKeyboardMovement } from '../utils/keyboard-movement'
import { CommentComposerFrame } from './comment-composer'
import { CommentMarker } from './comment-marker'
import { MentionInput } from './mention-input'
import { toCommentCollaborator } from './participants'
import { useCommentPopupPositioner } from './popup-placement'

type FlowPosition = { x: number; y: number }

type CommentInputProps = {
  /** Where the new comment goes on the canvas, in flow coordinates. */
  position: FlowPosition
  onSubmit: (content: string, mentionedUserIds: string[]) => Promise<void> | void
  onCancel: () => void
  /** The comment is being created; its text stays, read-only, until it is. */
  submitting?: boolean
  /** A preview that follows the pointer before the comment is placed. */
  disabled?: boolean
  onPositionChange?: (position: FlowPosition) => void
}

/**
 * A new comment: its marker on the canvas and, in a popover beside it, the input. The marker
 * moves with the canvas, and the input stays in view, still in use, when the marker leaves it.
 */
export const CommentInput: FC<CommentInputProps> = memo(
  ({ position, onSubmit, onCancel, submitting = false, disabled = false, onPositionChange }) => {
    const [content, setContent] = useState('')
    const [keyboardMoving, setKeyboardMoving] = useState(false)
    const moveDescriptionId = useId()
    const markerRef = useRef<HTMLButtonElement>(null)
    const inputRef = useRef<HTMLTextAreaElement>(null)
    const { t } = useTranslation(['workflow', 'workflowComments'])
    const addLabel = t(($) => $['comments.placeholder.add'], { ns: 'workflowComments' })
    const { data: userProfile } = useSuspenseQuery({
      ...userProfileQueryOptions(),
      select: (data) => data.profile,
    })
    const popupPositioner = useCommentPopupPositioner()
    const { screenToFlowPosition } = useReactFlow()
    // The canvas fills the comment layer, so the marker sits where the viewport puts the point.
    const viewport = useViewport()
    const canvasPosition = {
      x: position.x * viewport.zoom + viewport.x,
      y: position.y * viewport.zoom + viewport.y,
    }

    const dragStateRef = useRef<{
      pointerId: number
      offsetX: number
      offsetY: number
      endHandler: (event: PointerEvent) => void
    } | null>(null)

    const handleDragPointerMove = useCallback(
      (event: PointerEvent) => {
        const state = dragStateRef.current
        if (!state || event.pointerId !== state.pointerId || !onPositionChange) return
        event.preventDefault()
        onPositionChange(
          screenToFlowPosition({
            x: event.clientX - state.offsetX,
            y: event.clientY - state.offsetY,
          }),
        )
      },
      [onPositionChange, screenToFlowPosition],
    )

    const stopDragging = useCallback(
      (event?: PointerEvent) => {
        const state = dragStateRef.current
        if (!state) return
        if (event && event.pointerId !== state.pointerId) return
        dragStateRef.current = null
        window.removeEventListener('pointermove', handleDragPointerMove)
        window.removeEventListener('pointerup', state.endHandler)
        window.removeEventListener('pointercancel', state.endHandler)
      },
      [handleDragPointerMove],
    )

    const handleDragPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return
      event.stopPropagation()
      event.preventDefault()
      if (!onPositionChange) return
      // The marker's point is its bottom-left corner; keep the pointer where it grabbed it.
      const anchorRect = event.currentTarget.getBoundingClientRect()
      const endHandler = (pointerEvent: PointerEvent) => stopDragging(pointerEvent)
      dragStateRef.current = {
        pointerId: event.pointerId,
        offsetX: event.clientX - anchorRect.left,
        offsetY: event.clientY - anchorRect.bottom,
        endHandler,
      }
      window.addEventListener('pointermove', handleDragPointerMove, { passive: false })
      window.addEventListener('pointerup', endHandler)
      window.addEventListener('pointercancel', endHandler)
    }

    useEffect(
      () => () => {
        stopDragging()
      },
      [stopDragging],
    )

    // Escape ends the draft only from the draft itself, after its editor has handled it.
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.nativeEvent.isComposing || event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onCancel()
    }

    return (
      <>
        {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- Escape bubbling from the marker after it handles its own keys. */}
        <div
          className={cn('absolute z-40', disabled && 'pointer-events-none opacity-80')}
          style={{ left: canvasPosition.x, top: canvasPosition.y }}
          data-comment-input
          onKeyDown={cancelOnEscape}
        >
          <IconButton
            ref={markerRef}
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
              onPositionChange({ x: position.x + delta.x, y: position.y + delta.y })
            }}
          >
            <CommentMarker selected participants={[toCommentCollaborator(userProfile)]} />
          </IconButton>
          <span id={moveDescriptionId} className="sr-only" aria-live="polite">
            {t(($) => $['keyboard.moveDraftHelp'], { ns: 'workflow' })}{' '}
            {t(($) => $['keyboard.position'], {
              ns: 'workflow',
              x: Math.round(position.x),
              y: Math.round(position.y),
            })}
          </span>
        </div>
        {/* Open while the draft lasts: it ends from Escape inside it, or from the canvas
            (see `CommentManager`), never from a press or key elsewhere on the page. */}
        <Popover open onOpenChange={(_open, eventDetails) => eventDetails.cancel()}>
          <PopoverPortal>
            <PopoverPositioner anchor={markerRef} {...popupPositioner}>
              <PopoverPopup
                aria-label={addLabel}
                initialFocus={disabled ? false : inputRef}
                // Shown where it was placed, at once, like the preview it replaces.
                className={cn('w-80 transition-none', disabled && 'pointer-events-none opacity-80')}
                data-comment-input
                onKeyDown={disabled ? undefined : cancelOnEscape}
              >
                <CommentComposerFrame className="shadow-lg">
                  <MentionInput
                    ref={inputRef}
                    value={content}
                    onChange={setContent}
                    onSubmit={onSubmit}
                    placeholder={addLabel}
                    // Focused as it mounts, so typing right after placing it is kept.
                    autoFocus={!disabled}
                    disabled={disabled}
                    loading={submitting}
                  />
                </CommentComposerFrame>
              </PopoverPopup>
            </PopoverPositioner>
          </PopoverPortal>
        </Popover>
      </>
    )
  },
)

CommentInput.displayName = 'CommentInput'
