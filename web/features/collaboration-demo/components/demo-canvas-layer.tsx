'use client'

import type { CursorAnchor, PlaybackFrame } from '../playback-script'
import { useDirection } from '@langgenius/dify-ui/direction-provider'
import {
  createPopoverHandle,
  Popover,
  PopoverPopup,
  PopoverPortal,
  PopoverPositioner,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore, useViewport } from 'reactflow'
import { CollaboratorCursor } from '@/app/components/workflow/collaboration/components/collaborator-cursor'
import { NodeEditorAvatars } from '@/app/components/workflow/collaboration/components/node-editors'
import {
  CommentComposerActions,
  CommentComposerField,
  CommentComposerFrame,
} from '@/app/components/workflow/comment/comment-composer'
import { CommentMarker } from '@/app/components/workflow/comment/comment-marker'
import {
  commentDraftPlacement,
  commentThreadPlacement,
  getCommentPopupBounds,
} from '@/app/components/workflow/comment/popup-placement'
import {
  CommentMessage,
  CommentReplyBar,
  CommentThreadItem,
  CommentThreadList,
  CommentThreadPopup,
} from '@/app/components/workflow/comment/thread-view'
import { demoNodePositions } from '../demo-graph'
import { demoUsers } from '../demo-users'
import { demoCommentPosition, demoMessages } from '../playback-script'
import { useMessageContent } from '../use-message-content'

type Point = { x: number; y: number }
type Box = { left: number; top: number; height: number }

const mentionNames = Object.values(demoUsers).map(({ name }) => name)

function DraftInput({
  draft,
  placeholder,
}: {
  draft: PlaybackFrame['draft']
  placeholder: string
}) {
  const messageContent = useMessageContent()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const message = draft && demoMessages.find(({ id }) => id === draft.message)
  const text = message ? messageContent(message) : ''
  const typed = draft ? text.slice(0, Math.round(text.length * draft.progress)) : ''

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (textarea) textarea.scrollTop = textarea.scrollHeight
  }, [typed])

  return (
    <div inert>
      <CommentComposerField
        ref={textareaRef}
        readOnly
        value={typed}
        mentionNames={mentionNames}
        placeholder={placeholder}
        actions={<CommentComposerActions canSend={Boolean(typed)} />}
      />
    </div>
  )
}

type DemoCanvasLayerProps = {
  frame: PlaybackFrame
  markerInteractive: boolean
  finished: boolean
  reducedMotion: boolean
  threadOpen: boolean
  /** `fromMarker`: opened by pressing the marker, so the thread takes focus. */
  onThreadOpenChange: (open: boolean, fromMarker: boolean) => void
  focusThread: boolean
}

export function DemoCanvasLayer({
  frame,
  markerInteractive,
  finished,
  reducedMotion,
  threadOpen,
  onThreadOpenChange,
  focusThread,
}: DemoCanvasLayerProps) {
  const { t } = useTranslation(['collaborationDemo', 'workflowComments'])
  const messageContent = useMessageContent()
  const { x: vx, y: vy, zoom } = useViewport()
  const canvas = useStore((state) => state.domNode)
  const direction = useDirection()
  const canvasBounds = getCommentPopupBounds({ canvas: canvas ?? null, direction })
  // The preview's minimap stands 128px tall at the canvas's bottom end.
  const popupBounds = {
    ...canvasBounds,
    collisionPadding: { ...canvasBounds.collisionPadding, bottom: 136 },
  }
  const [layer, setLayer] = useState<HTMLDivElement | null>(null)
  const [marker, setMarker] = useState<HTMLDivElement | null>(null)
  const [popup, setPopup] = useState<HTMLDivElement | null>(null)
  const [threadBox, setThreadBox] = useState<Box>()
  const listRef = useRef<HTMLDivElement>(null)
  const markerTriggerRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef(false)
  const [threadHandle] = useState(createPopoverHandle)
  const visibleMessages = frame.visibleMessages
  const threadShown = frame.marker === 'thread' && threadOpen

  useEffect(() => {
    const list = listRef.current
    if (list && visibleMessages > 0)
      list.scrollTo({ top: list.scrollHeight, behavior: reducedMotion ? 'instant' : 'smooth' })
  }, [reducedMotion, visibleMessages])

  // Cursors move to the reply box only during playback, which renders every frame.
  const measureThread = () => {
    if (!popup || !layer) return setThreadBox(undefined)
    const origin = layer.getBoundingClientRect()
    const rect = popup.getBoundingClientRect()
    const box = { left: rect.left - origin.left, top: rect.top - origin.top, height: rect.height }
    setThreadBox((current) =>
      current?.left === box.left && current.top === box.top && current.height === box.height
        ? current
        : box,
    )
  }
  useLayoutEffect(measureThread)

  const toScreen = ({ x, y }: Point) => ({ x: x * zoom + vx, y: y * zoom + vy })
  const pin = toScreen(demoCommentPosition)
  const anchorToScreen = (anchor: CursorAnchor) =>
    anchor === 'reply'
      ? threadBox
        ? { x: threadBox.left + 72, y: threadBox.top + threadBox.height - 32 }
        : pin
      : toScreen(anchor)
  const cursorPosition = ({ from, to, progress }: PlaybackFrame['alex']) => {
    const start = anchorToScreen(from)
    const end = anchorToScreen(to)
    return {
      left: start.x + (end.x - start.x) * progress,
      top: start.y + (end.y - start.y) * progress,
    }
  }
  const viewing = frame.samViewing && toScreen(demoNodePositions[frame.samViewing])
  const participants = visibleMessages > 1 ? [demoUsers.alex, demoUsers.sam] : [demoUsers.alex]
  const replyDraft = frame.draft?.message === demoMessages[0]!.id ? undefined : frame.draft

  return (
    <div ref={setLayer} className="pointer-events-none absolute inset-0 z-5 overflow-clip">
      {viewing && (
        <div
          inert
          aria-hidden
          className="absolute flex origin-top-left"
          style={{ left: viewing.x + 206 * zoom, top: viewing.y + 17 * zoom, scale: zoom }}
        >
          <NodeEditorAvatars editors={[demoUsers.sam]} />
        </div>
      )}

      {frame.marker && (
        <div
          ref={setMarker}
          className="absolute -translate-y-full"
          style={{ left: pin.x, top: pin.y }}
        >
          {frame.marker === 'composing' ? (
            <CommentMarker aria-hidden selected participants={participants} />
          ) : (
            <PopoverTrigger
              ref={markerTriggerRef}
              handle={threadHandle}
              disabled={!markerInteractive}
              aria-label={t(($) => $['thread.open'], {
                name: demoUsers.alex.name,
                count: visibleMessages - 1,
              })}
              className="pointer-events-auto flex cursor-pointer rounded-[13.5px] rounded-es-[3px] focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden disabled:cursor-default"
            >
              <CommentMarker participants={participants} selected={threadShown} />
            </PopoverTrigger>
          )}
        </div>
      )}

      <div aria-hidden>
        {(['alex', 'sam'] as const).map((user) => (
          <CollaboratorCursor
            key={user}
            name={demoUsers[user].name}
            color={demoUsers[user].color}
            className={markerInteractive ? 'absolute' : 'absolute z-40'}
            style={cursorPosition(frame[user])}
          />
        ))}
      </div>

      <Popover open={frame.marker === 'composing' && Boolean(marker)}>
        <PopoverPortal container={layer}>
          <PopoverPositioner
            anchor={marker}
            {...commentDraftPlacement}
            {...popupBounds}
            dir={direction}
          >
            <PopoverPopup
              inert
              aria-hidden
              initialFocus={false}
              finalFocus={false}
              className="w-80 transition-none"
            >
              <CommentComposerFrame className="shadow-lg">
                <DraftInput
                  draft={frame.draft}
                  placeholder={t(($) => $['comments.placeholder.add'], { ns: 'workflowComments' })}
                />
              </CommentComposerFrame>
            </PopoverPopup>
          </PopoverPositioner>
        </PopoverPortal>
      </Popover>

      <Popover
        handle={threadHandle}
        open={threadShown && Boolean(marker)}
        onOpenChange={(open, details) => {
          const fromMarker = details.reason === 'trigger-press'
          const target = details.event.target
          const onControls =
            details.reason === 'outside-press' &&
            target instanceof Element &&
            target.closest('[data-role="demo-controls"]')
          const escapeInThread =
            details.reason === 'escape-key' && target instanceof Node && popup?.contains(target)
          const closes =
            details.reason === 'close-press' ||
            (markerInteractive && (fromMarker || escapeInThread)) ||
            (finished && details.reason !== 'escape-key' && !onControls)
          if (open ? fromMarker : closes) {
            returnFocusRef.current =
              details.reason === 'close-press' || details.reason === 'escape-key'
            onThreadOpenChange(open, fromMarker)
          } else details.cancel()
        }}
        onOpenChangeComplete={(open) => {
          if (open || !returnFocusRef.current) return
          returnFocusRef.current = false
          markerTriggerRef.current?.focus()
        }}
      >
        <PopoverPortal container={layer}>
          <PopoverPositioner
            anchor={marker}
            {...commentThreadPlacement}
            {...popupBounds}
            dir={direction}
          >
            <CommentThreadPopup
              ref={setPopup}
              title={t(($) => $['comments.panelTitle'], { ns: 'workflowComments' })}
              closeLabel={t(($) => $['thread.close'])}
              initialFocus={focusThread}
              finalFocus={false}
              className="nowheel nopan pointer-events-auto"
            >
              <CommentThreadList ref={listRef}>
                {demoMessages.slice(0, visibleMessages).map((message) => (
                  <CommentThreadItem
                    key={message.id}
                    className="motion-safe:transition-opacity motion-safe:duration-300 motion-safe:starting:opacity-0"
                  >
                    <CommentMessage
                      author={demoUsers[message.author]}
                      timeLabel={t(($) => $['thread.justNow'])}
                      content={messageContent(message)}
                      mentionNames={mentionNames}
                    />
                  </CommentThreadItem>
                ))}
              </CommentThreadList>
              <div aria-hidden>
                <CommentReplyBar author={demoUsers[frame.replyAuthor]}>
                  <DraftInput
                    draft={replyDraft}
                    placeholder={t(($) => $['comments.placeholder.reply'], {
                      ns: 'workflowComments',
                    })}
                  />
                </CommentReplyBar>
              </div>
            </CommentThreadPopup>
          </PopoverPositioner>
        </PopoverPortal>
      </Popover>
    </div>
  )
}
