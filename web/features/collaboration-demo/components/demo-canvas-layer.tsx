'use client'

import type { Ref } from 'react'
import type { DemoUserId } from '../demo-users'
import type { CursorAnchor, PlaybackFrame } from '../playback-script'
import { AvatarGroup } from '@langgenius/dify-ui/avatar'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore, useViewport } from 'reactflow'
import { demoNodePositions } from '../demo-graph'
import { demoUsers } from '../demo-users'
import { getThreadPlacement } from '../demo-viewport'
import { demoCommentPosition, demoMessages } from '../playback-script'
import { DemoAvatar } from './demo-avatar'

type Point = { x: number; y: number }

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
        className="absolute inset-s-4 top-4 rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-white shadow-sm"
        style={{ backgroundColor: color }}
      >
        {name}
      </div>
    </div>
  )
}

function MessageText({
  id,
  mention,
}: {
  id: (typeof demoMessages)[number]['id']
  mention?: DemoUserId
}) {
  const { t } = useTranslation(['collaborationDemo'])
  return (
    <>
      {mention && <span className="text-primary-600">@{demoUsers[mention].name} </span>}
      {t(($) => $[`messages.${id}`])}
    </>
  )
}

function DraftInput({
  draft,
  placeholder,
}: {
  draft: PlaybackFrame['draft']
  placeholder: string
}) {
  const { t } = useTranslation(['collaborationDemo'])
  const message = draft && demoMessages.find(({ id }) => id === draft.message)
  const text = message
    ? `${message.mention ? `@${demoUsers[message.mention].name} ` : ''}${t(($) => $[`messages.${message.id}`])}`
    : ''
  const typed = draft ? text.slice(0, Math.round(text.length * draft.progress)) : ''

  return (
    <div className="relative flex items-center">
      <div className="max-h-24 min-h-8 w-full overflow-hidden p-1 pe-20 body-lg-regular leading-6 wrap-break-word whitespace-pre-wrap text-text-primary">
        {typed || <span className="text-text-tertiary">{placeholder}</span>}
      </div>
      <div className="absolute inset-e-1 bottom-0 flex items-end gap-1">
        <span className="flex size-8 items-center justify-center rounded-lg opacity-40">
          <span className="i-ri-at-line size-4 text-text-tertiary" />
        </span>
        <span
          data-ready={typed ? '' : undefined}
          className="ms-2 flex size-8 items-center justify-center rounded-lg bg-components-button-primary-bg-disabled data-ready:bg-components-button-primary-bg"
        >
          <span className="i-ri-arrow-up-line size-4 text-components-button-primary-text" />
        </span>
      </div>
    </div>
  )
}

type DemoCanvasLayerProps = {
  frame: PlaybackFrame | undefined
  playing: boolean
  reducedMotion: boolean
  threadOpen: boolean
  onThreadOpenChange: (open: boolean) => void
  markerRef: Ref<HTMLButtonElement>
  threadCloseRef: Ref<HTMLButtonElement>
}

export function DemoCanvasLayer({
  frame,
  playing,
  reducedMotion,
  threadOpen,
  onThreadOpenChange,
  markerRef,
  threadCloseRef,
}: DemoCanvasLayerProps) {
  const { t } = useTranslation(['collaborationDemo', 'workflow', 'workflowComments'])
  const { x: vx, y: vy, zoom } = useViewport()
  const width = useStore((state) => state.width)
  const height = useStore((state) => state.height)
  const listRef = useRef<HTMLDivElement>(null)
  const toScreen = ({ x, y }: Point) => ({ x: x * zoom + vx, y: y * zoom + vy })
  const visibleMessages = frame?.visibleMessages ?? 0

  useEffect(() => {
    const list = listRef.current
    if (list && visibleMessages > 0)
      list.scrollTo({ top: list.scrollHeight, behavior: reducedMotion ? 'instant' : 'smooth' })
  }, [reducedMotion, visibleMessages])

  if (!frame) return null

  const pin = toScreen(demoCommentPosition)
  const thread = getThreadPlacement(pin, { width, height })
  const anchorToScreen = (anchor: CursorAnchor) =>
    anchor === 'reply' ? { x: thread.left + 90, y: thread.top + 326 } : toScreen(anchor)
  const cursorPosition = ({ from, to, progress }: PlaybackFrame['alex']) => {
    const start = anchorToScreen(from)
    const end = anchorToScreen(to)
    return {
      x: start.x + (end.x - start.x) * progress,
      y: start.y + (end.y - start.y) * progress,
    }
  }
  const viewing = frame.samViewing && toScreen(demoNodePositions[frame.samViewing])
  const participants: DemoUserId[] = visibleMessages > 1 ? ['alex', 'sam'] : ['alex']
  const messages = demoMessages.slice(0, visibleMessages)
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
          className="absolute flex w-96 items-center gap-3"
          style={{ left: Math.min(pin.x, width - 392), top: pin.y }}
        >
          <div className="relative aspect-square h-8 w-8 shrink-0 rounded-ss-full rounded-se-full rounded-ee-full bg-primary-500 p-0.5">
            <div className="flex size-full items-center justify-center overflow-hidden rounded-ss-full rounded-se-full rounded-ee-full bg-components-panel-bg-blur p-0.5">
              <DemoAvatar user="alex" className="block size-full rounded-full ring-0" />
            </div>
          </div>
          <div className="relative z-10 flex-1 rounded-xl border border-components-chat-input-border bg-components-panel-bg-blur pb-1 shadow-md">
            <div className="relative ps-2.25 pt-1">
              <DraftInput
                draft={frame.draft}
                placeholder={t(($) => $['comments.placeholder.add'], { ns: 'workflowComments' })}
              />
            </div>
          </div>
        </div>
      )}

      {frame.marker === 'thread' && (
        <>
          {threadOpen ? (
            <div
              aria-hidden
              className="absolute -translate-1/2"
              style={{ left: pin.x, top: pin.y }}
            >
              <MarkerBubble participants={participants} active />
            </div>
          ) : (
            <IconButton
              ref={markerRef}
              aria-label={t(($) => $['keyboard.openComment'], {
                ns: 'workflow',
                name: demoUsers.alex.name,
              })}
              className="pointer-events-auto absolute h-auto w-auto -translate-1/2 border-0 bg-transparent p-0"
              style={{ left: pin.x, top: pin.y }}
              onClick={() => onThreadOpenChange(true)}
            >
              <MarkerBubble participants={participants} />
            </IconButton>
          )}
          {threadOpen && (
            <section
              aria-labelledby="collaboration-demo-thread-title"
              className="nowheel nopan pointer-events-auto absolute z-30 w-90 max-w-90"
              style={thread}
            >
              <div className="relative flex h-90 flex-col overflow-hidden rounded-2xl border border-components-panel-border bg-components-panel-bg shadow-xl">
                <div className="flex items-center justify-between rounded-t-2xl border-b border-components-panel-border bg-components-panel-bg-blur px-4 py-3">
                  <h2
                    id="collaboration-demo-thread-title"
                    className="font-semibold text-text-primary uppercase"
                  >
                    {t(($) => $['comments.panelTitle'], { ns: 'workflowComments' })}
                  </h2>
                  <button
                    ref={threadCloseRef}
                    type="button"
                    aria-label={t(($) => $['thread.close'])}
                    className="flex size-6 cursor-pointer items-center justify-center rounded-lg text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
                    onClick={() => onThreadOpenChange(false)}
                  >
                    <span aria-hidden className="i-ri-close-line size-4" />
                  </button>
                </div>
                <div
                  ref={listRef}
                  role="log"
                  aria-live={playing ? 'polite' : 'off'}
                  aria-relevant="additions"
                  className="relative mt-2 flex-1 overflow-y-auto px-4 pb-4"
                >
                  {messages.map((message, index) => (
                    <article
                      key={message.id}
                      data-reply={index > 0 || undefined}
                      className="relative -mx-4 rounded-lg px-4 py-2 data-reply:mt-3 motion-safe:transition-opacity motion-safe:duration-300 motion-safe:starting:opacity-0"
                    >
                      <div className="flex gap-3 pt-1">
                        <DemoAvatar user={message.author} size="md" className="shrink-0 ring-0" />
                        <div className="min-w-0 flex-1 text-text-primary">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="system-sm-medium text-text-primary">
                              {demoUsers[message.author].name}
                            </span>
                            <span aria-hidden className="system-2xs-regular text-text-tertiary">
                              {t(($) => $['thread.justNow'])}
                            </span>
                          </div>
                          <p className="mt-1 system-sm-regular wrap-break-word whitespace-pre-wrap text-text-secondary">
                            <MessageText id={message.id} mention={message.mention} />
                          </p>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
                <div aria-hidden className="border-t border-components-panel-border px-4 py-3">
                  <div className="flex items-center gap-3">
                    <DemoAvatar user={frame.replyAuthor} size="md" className="ring-0" />
                    <div className="flex-1 rounded-xl border border-components-chat-input-border bg-components-panel-bg-blur p-0.5 shadow-sm">
                      <DraftInput
                        draft={replyDraft}
                        placeholder={t(($) => $['comments.placeholder.reply'], {
                          ns: 'workflowComments',
                        })}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}
        </>
      )}

      <RemoteCursor user="alex" {...cursorPosition(frame.alex)} />
      <RemoteCursor user="sam" {...cursorPosition(frame.sam)} />
    </div>
  )
}

function MarkerBubble({ participants, active }: { participants: DemoUserId[]; active?: boolean }) {
  return (
    <div
      className="relative h-10 rounded-ee-full rounded-t-full"
      style={{ width: Math.max(40, 8 + 24 + (participants.length - 1) * 20 + 8) }}
    >
      <div
        data-active={active || undefined}
        className={cn(
          'absolute inset-1.5 overflow-hidden rounded-ss-full rounded-se-full rounded-ee-full border border-components-panel-border bg-components-panel-bg transition-shadow',
          'data-active:border-primary-500 data-active:ring-1 data-active:ring-primary-500',
        )}
      >
        <div className="flex size-full items-center justify-center px-1">
          <AvatarGroup size="sm">
            {participants.map((user) => (
              <DemoAvatar key={user} user={user} />
            ))}
          </AvatarGroup>
        </div>
      </div>
    </div>
  )
}
