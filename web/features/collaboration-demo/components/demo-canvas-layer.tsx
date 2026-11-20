'use client'

import type { DemoUserId } from '../demo-users'
import type { getPlaybackFrame } from '../playback-script'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useViewport } from 'reactflow'
import { demoNodePositions } from '../demo-graph'
import { demoUsers } from '../demo-users'
import { demoCommentPosition, demoMessages } from '../playback-script'
import { DemoAvatar } from './demo-avatar'

type Frame = ReturnType<typeof getPlaybackFrame>

function RemoteCursor({ user, x, y }: { user: DemoUserId; x: number; y: number }) {
  const { color, name } = demoUsers[user]
  return (
    <div aria-hidden className="pointer-events-none absolute z-8" style={{ left: x, top: y }}>
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
        className="absolute inset-s-4 top-4 rounded-sm px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-white shadow-sm"
        style={{ backgroundColor: color }}
      >
        {name}
      </div>
    </div>
  )
}

export function DemoCanvasLayer({
  frame,
  playing,
  reducedMotion,
}: {
  frame: Frame | undefined
  playing: boolean
  reducedMotion: boolean
}) {
  const { t } = useTranslation(['collaborationDemo'])
  const { x: vx, y: vy, zoom } = useViewport()
  const listRef = useRef<HTMLDivElement>(null)
  const toScreen = ({ x, y }: { x: number; y: number }) => ({ x: x * zoom + vx, y: y * zoom + vy })
  const visibleMessages = frame?.visibleMessages ?? 0

  useEffect(() => {
    const list = listRef.current
    if (list && visibleMessages > 0)
      list.scrollTo({ top: list.scrollHeight, behavior: reducedMotion ? 'instant' : 'smooth' })
  }, [reducedMotion, visibleMessages])

  if (!frame) return null

  const pin = toScreen(demoCommentPosition)
  const viewing = frame.samViewing && toScreen(demoNodePositions[frame.samViewing])
  const participants: DemoUserId[] = visibleMessages > 1 ? ['alex', 'sam'] : ['alex']

  return (
    <div className="pointer-events-none absolute inset-0 z-5 overflow-hidden">
      {viewing && (
        <div
          className="absolute"
          style={{ left: viewing.x + 240 * zoom - 36, top: viewing.y + 12 }}
        >
          <DemoAvatar user="sam" />
        </div>
      )}
      {frame.threadOpen && (
        <>
          <div
            aria-hidden
            className="absolute flex h-10 -translate-y-full items-center rounded-ee-full rounded-t-full border border-primary-500 bg-components-panel-bg px-1.5 shadow-md ring-1 ring-primary-500"
            style={{ left: pin.x, top: pin.y }}
          >
            <span className="flex -space-x-1.5">
              {participants.map((user) => (
                <DemoAvatar key={user} user={user} />
              ))}
            </span>
          </div>
          <section
            aria-label={t(($) => $['thread.title'])}
            className="nowheel nopan pointer-events-auto absolute flex h-80 w-90 flex-col overflow-hidden rounded-2xl border border-components-panel-border bg-components-panel-bg shadow-xl"
            style={{ left: pin.x + 56, top: pin.y - 300 }}
          >
            <h2 className="border-b border-components-panel-border bg-components-panel-bg-blur px-4 py-3 font-semibold text-text-primary uppercase">
              {t(($) => $['thread.title'])}
            </h2>
            <div
              ref={listRef}
              role="log"
              aria-live={playing ? 'polite' : 'off'}
              className="flex-1 overflow-y-auto px-4 pt-2 pb-4"
            >
              {demoMessages.slice(0, visibleMessages).map((message) => (
                <article
                  key={message.id}
                  className="flex gap-3 py-2 transition-opacity duration-300 motion-reduce:transition-none starting:opacity-0"
                >
                  <DemoAvatar user={message.author} className="shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="system-sm-medium text-text-primary">
                        {demoUsers[message.author].name}
                      </span>
                      <span className="system-2xs-regular text-text-tertiary">
                        {t(($) => $['thread.justNow'])}
                      </span>
                    </div>
                    <p className="mt-1 system-sm-regular text-text-secondary">
                      {t(($) => $[`messages.${message.id}`])}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </>
      )}
      <RemoteCursor user="alex" {...toScreen(frame.alex)} />
      <RemoteCursor user="sam" {...toScreen(frame.sam)} />
    </div>
  )
}
