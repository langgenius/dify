'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useMediaQuery } from '@langgenius/dify-ui/use-media-query'
import { useMergedRefs } from '@langgenius/dify-ui/use-merged-refs'
import { useHotkey } from '@tanstack/react-hotkeys'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { demoUsers } from '../demo-users'
import { demoDuration, demoMessages, getPlaybackFrame } from '../playback-script'
import { usePlayback } from '../use-playback'
import { DemoCanvasLayer } from './demo-canvas-layer'
import { DemoEndPanel } from './demo-end-panel'

const focusOnMount = (element: HTMLElement | null) => element?.focus()

export function DemoPlayback() {
  const { t } = useTranslation(['collaborationDemo'])
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)', { noSsr: true })
  const playback = usePlayback(demoDuration)
  const [threadOpen, setThreadOpen] = useState(true)
  const reopenedRef = useRef(false)
  const pauseRef = useRef<HTMLButtonElement>(null)
  const pauseButtonRef = useMergedRefs(pauseRef, focusOnMount)
  const frame = getPlaybackFrame(playback.seconds, reducedMotion)

  useHotkey('Escape', playback.pause, { enabled: playback.playing })

  const changeThreadOpen = (open: boolean) => {
    reopenedRef.current = open
    if (!open && !playback.finished) pauseRef.current?.focus()
    setThreadOpen(open)
  }
  const focusReopenedThread = (element: HTMLButtonElement | null) => {
    if (!element || !reopenedRef.current) return
    reopenedRef.current = false
    element.focus()
  }

  return (
    <>
      <div
        role="log"
        aria-live={playback.playing ? 'polite' : 'off'}
        aria-relevant="additions"
        className="sr-only"
      >
        {demoMessages.slice(0, frame.visibleMessages).map((message) => (
          <p key={message.id}>
            {demoUsers[message.author].name}:{' '}
            {message.mention && `@${demoUsers[message.mention].name} `}
            {t(($) => $[`messages.${message.id}`])}
          </p>
        ))}
      </div>
      <DemoCanvasLayer
        frame={frame}
        markerInteractive={playback.finished}
        reducedMotion={reducedMotion}
        threadOpen={threadOpen}
        onThreadOpenChange={changeThreadOpen}
        markerRef={focusOnMount}
        threadCloseRef={focusReopenedThread}
      />
      {playback.finished ? (
        <>
          <div className="pointer-events-none absolute inset-0 z-20 bg-background-overlay-alt motion-safe:transition-opacity motion-safe:duration-300 motion-safe:starting:opacity-0" />
          <DemoEndPanel
            onReplay={() => {
              setThreadOpen(true)
              playback.restart()
            }}
          />
        </>
      ) : (
        <div className="pointer-events-auto absolute inset-x-0 bottom-4 z-20 mx-auto flex w-fit items-center gap-1 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-1 shadow-lg">
          <Button
            ref={pauseButtonRef}
            variant="ghost"
            onClick={playback.playing ? playback.pause : playback.play}
          >
            <span
              aria-hidden
              className={playback.playing ? 'i-ri-pause-line size-4' : 'i-ri-play-line size-4'}
            />
            {playback.playing ? t(($) => $['playback.pause']) : t(($) => $['playback.resume'])}
          </Button>
          <Button variant="ghost" onClick={playback.skip}>
            {t(($) => $['playback.skip'])}
          </Button>
        </div>
      )}
    </>
  )
}
