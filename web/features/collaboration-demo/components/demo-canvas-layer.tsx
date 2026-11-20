'use client'

import type { Ref } from 'react'
import type { DemoUserId } from '../demo-users'
import type { CursorAnchor, PlaybackFrame } from '../playback-script'
import { AvatarGroup } from '@langgenius/dify-ui/avatar'
import { cn } from '@langgenius/dify-ui/cn'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore, useViewport } from 'reactflow'
import { demoNodePositions } from '../demo-graph'
import { demoUsers } from '../demo-users'
import { getThreadPlacement } from '../demo-viewport'
import { demoCommentPosition, demoMessages } from '../playback-script'
import { DemoAvatar } from './demo-avatar'

type Point = { x: number; y: number }
type MessageId = (typeof demoMessages)[number]['id']

const floatingShadow =
  'shadow-[0_12px_16px_-4px_var(--color-shadow-shadow-5),0_4px_6px_-2px_var(--color-shadow-shadow-1)]'

function RemoteCursor({ user, x, y }: { user: DemoUserId } & Point) {
  const { color, name } = demoUsers[user]
  return (
    <div aria-hidden className="pointer-events-none absolute z-40" style={{ left: x, top: y }}>
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="drop-shadow-md">
        <path
          d="M5 3L5 15L8 11.5L11 16L13 15L10 10.5L14 10.5L5 3Z"
          fill={color}
          stroke="white"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
      <div
        className="absolute inset-s-4 top-4 rounded-sm px-1.5 py-0.5 system-xs-medium whitespace-nowrap text-white shadow-sm"
        style={{ backgroundColor: color }}
      >
        {name}
      </div>
    </div>
  )
}

function MarkerBubble({
  participants,
  selected,
}: {
  participants: DemoUserId[]
  selected?: boolean
}) {
  return (
    <div
      data-selected={selected || undefined}
      className={cn(
        'relative flex rounded-[13.5px] rounded-es-[3px] bg-components-panel-bg-blur p-[1.5px] after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:border-[0.5px] after:border-components-panel-border data-selected:after:border-[1.5px] data-selected:after:border-components-option-card-option-selected-border',
        floatingShadow,
      )}
    >
      <AvatarGroup size="sm">
        {participants.map((user) => (
          <DemoAvatar key={user} user={user} />
        ))}
      </AvatarGroup>
    </div>
  )
}

function useMessageText() {
  const { t } = useTranslation(['collaborationDemo'])
  return (id: MessageId) => t(($) => $[`messages.${id}`])
}

function DraftInput({
  draft,
  placeholder,
}: {
  draft: PlaybackFrame['draft']
  placeholder: string
}) {
  const messageText = useMessageText()
  const message = draft && demoMessages.find(({ id }) => id === draft.message)
  const text = message
    ? `${message.mention ? `@${demoUsers[message.mention].name} ` : ''}${messageText(message.id)}`
    : ''
  const typed = draft ? text.slice(0, Math.round(text.length * draft.progress)) : ''

  return (
    <div className="flex items-end gap-1">
      <div className="max-h-24 min-w-0 flex-1 overflow-hidden px-2 py-1.5 body-sm-regular wrap-break-word text-text-primary">
        {typed || <span className="text-components-input-text-placeholder">{placeholder}</span>}
      </div>
      {!typed && (
        <span className="flex size-7 shrink-0 items-center justify-center">
          <span className="i-ri-mic-line size-4 text-text-tertiary" />
        </span>
      )}
      <span className="flex size-7 shrink-0 items-center justify-center">
        <span className="i-ri-at-line size-4 text-text-tertiary" />
      </span>
      <span
        data-ready={typed ? '' : undefined}
        className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-components-button-primary-bg-disabled data-ready:bg-components-button-primary-bg"
      >
        <span className="i-ri-arrow-up-line size-4 text-components-button-primary-text" />
      </span>
    </div>
  )
}

type DemoCanvasLayerProps = {
  frame: PlaybackFrame
  markerInteractive: boolean
  reducedMotion: boolean
  threadOpen: boolean
  onThreadOpenChange: (open: boolean) => void
  markerRef: Ref<HTMLButtonElement>
  threadCloseRef: Ref<HTMLButtonElement>
}

export function DemoCanvasLayer({
  frame,
  markerInteractive,
  reducedMotion,
  threadOpen,
  onThreadOpenChange,
  markerRef,
  threadCloseRef,
}: DemoCanvasLayerProps) {
  const { t } = useTranslation(['collaborationDemo', 'workflowComments'])
  const messageText = useMessageText()
  const { x: vx, y: vy, zoom } = useViewport()
  const width = useStore((state) => state.width)
  const height = useStore((state) => state.height)
  const listRef = useRef<HTMLDivElement>(null)
  const [threadElement, setThreadElement] = useState<HTMLElement | null>(null)
  const [threadHeight, setThreadHeight] = useState(0)
  const visibleMessages = frame.visibleMessages

  useEffect(() => {
    const list = listRef.current
    if (list && visibleMessages > 0)
      list.scrollTo({ top: list.scrollHeight, behavior: reducedMotion ? 'instant' : 'smooth' })
  }, [reducedMotion, visibleMessages])

  useEffect(() => {
    if (!threadElement) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setThreadHeight(entry.borderBoxSize[0]!.blockSize)
    })
    observer.observe(threadElement)
    return () => observer.disconnect()
  }, [threadElement])

  const toScreen = ({ x, y }: Point) => ({ x: x * zoom + vx, y: y * zoom + vy })
  const pin = toScreen(demoCommentPosition)
  const thread = getThreadPlacement(pin, { width, height })
  const anchorToScreen = (anchor: CursorAnchor) =>
    anchor === 'reply'
      ? { x: thread.left + 72, y: thread.top + threadHeight - 32 }
      : toScreen(anchor)
  const cursorPosition = ({ from, to, progress }: PlaybackFrame['alex']) => {
    const start = anchorToScreen(from)
    const end = anchorToScreen(to)
    return { x: start.x + (end.x - start.x) * progress, y: start.y + (end.y - start.y) * progress }
  }
  const viewing = frame.samViewing && toScreen(demoNodePositions[frame.samViewing])
  const participants: DemoUserId[] = visibleMessages > 1 ? ['alex', 'sam'] : ['alex']
  const replyDraft = frame.draft?.message === demoMessages[0]!.id ? undefined : frame.draft

  return (
    <div className="pointer-events-none absolute inset-0 z-5 overflow-hidden">
      {viewing && (
        <div
          aria-hidden
          className="absolute origin-top-left"
          style={{ left: viewing.x + 206 * zoom, top: viewing.y + 15 * zoom, scale: zoom }}
        >
          <AvatarGroup size="sm">
            <DemoAvatar user="sam" />
          </AvatarGroup>
        </div>
      )}

      {frame.marker === 'composing' && (
        <div
          aria-hidden
          className="absolute flex items-start gap-3"
          style={{ left: Math.min(pin.x, width - 368), top: pin.y - 27 }}
        >
          <MarkerBubble participants={['alex']} selected />
          <div className={cn('w-80 rounded-xl bg-components-panel-bg p-1', floatingShadow)}>
            <DraftInput
              draft={frame.draft}
              placeholder={t(($) => $['comments.placeholder.add'], { ns: 'workflowComments' })}
            />
          </div>
        </div>
      )}

      {frame.marker === 'thread' &&
        (threadOpen || !markerInteractive ? (
          <div
            aria-hidden
            className="absolute -translate-y-full"
            style={{ left: pin.x, top: pin.y }}
          >
            <MarkerBubble participants={participants} selected={threadOpen} />
          </div>
        ) : (
          <button
            ref={markerRef}
            type="button"
            aria-label={t(($) => $['thread.open'], {
              name: demoUsers.alex.name,
              count: visibleMessages - 1,
            })}
            className="pointer-events-auto absolute -translate-y-full cursor-pointer rounded-[13.5px] rounded-es-[3px] focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
            style={{ left: pin.x, top: pin.y }}
            onClick={() => onThreadOpenChange(true)}
          >
            <MarkerBubble participants={participants} />
          </button>
        ))}

      {frame.marker === 'thread' && threadOpen && (
        <section
          ref={setThreadElement}
          aria-labelledby="collaboration-demo-thread-title"
          className="nowheel nopan pointer-events-auto absolute z-30 flex w-90 flex-col overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-[0_20px_24px_-4px_var(--color-shadow-shadow-5),0_8px_8px_-4px_var(--color-shadow-shadow-1)]"
          style={thread}
        >
          <div className="flex items-center justify-between border-b border-divider-subtle py-1 ps-4 pe-2">
            <h2
              id="collaboration-demo-thread-title"
              className="system-sm-semibold text-text-primary uppercase"
            >
              {t(($) => $['comments.panelTitle'], { ns: 'workflowComments' })}
            </h2>
            <button
              ref={threadCloseRef}
              type="button"
              aria-label={t(($) => $['thread.close'])}
              className="flex size-7 cursor-pointer items-center justify-center rounded-lg text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
              onClick={() => onThreadOpenChange(false)}
            >
              <span aria-hidden className="i-ri-close-line size-4" />
            </button>
          </div>
          <div ref={listRef} className="max-h-70 overflow-y-auto">
            {demoMessages.slice(0, visibleMessages).map((message) => (
              <article
                key={message.id}
                className="flex gap-3 py-3 ps-4 pe-3 motion-safe:transition-opacity motion-safe:duration-300 motion-safe:starting:opacity-0"
              >
                <DemoAvatar user={message.author} className="shrink-0 ring-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1">
                    <span className="system-sm-medium text-text-primary">
                      {demoUsers[message.author].name}
                    </span>
                    <span aria-hidden className="system-xs-regular text-text-tertiary">
                      {t(($) => $['thread.justNow'])}
                    </span>
                  </div>
                  <p className="mt-0.5 body-sm-regular wrap-break-word text-text-secondary">
                    {message.mention && (
                      <span className="text-text-accent">@{demoUsers[message.mention].name} </span>
                    )}
                    {messageText(message.id)}
                  </p>
                </div>
              </article>
            ))}
          </div>
          <div
            aria-hidden
            className="flex items-center gap-3 border-t-[0.5px] border-divider-subtle bg-linear-to-b from-background-gradient-bg-fill-chat-bg-1 to-background-gradient-bg-fill-chat-bg-2 py-3 ps-4 pe-3"
          >
            <DemoAvatar user={frame.replyAuthor} className="shrink-0 ring-0" />
            <div className="min-w-0 flex-1 rounded-xl border border-components-panel-bg bg-components-input-bg-normal p-1">
              <DraftInput
                draft={replyDraft}
                placeholder={t(($) => $['comments.placeholder.reply'], { ns: 'workflowComments' })}
              />
            </div>
          </div>
        </section>
      )}

      <RemoteCursor user="alex" {...cursorPosition(frame.alex)} />
      <RemoteCursor user="sam" {...cursorPosition(frame.sam)} />
    </div>
  )
}
