'use client'

import type { DemoEndState } from '../end-state'
import { Button } from '@langgenius/dify-ui/button'
import { useMediaQuery } from '@langgenius/dify-ui/use-media-query'
import { useHotkey } from '@tanstack/react-hotkeys'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { demoUsers } from '../demo-users'
import { useFitDemoViewport } from '../demo-viewport'
import { demoDuration, demoMessages, getPlaybackFrame } from '../playback-script'
import { useMessageContent } from '../use-message-content'
import { usePlayback } from '../use-playback'
import { DemoCanvasLayer } from './demo-canvas-layer'
import { DemoEndPanel } from './demo-end-panel'

const focusOnMount = (element: HTMLElement | null) => element?.focus()

export function DemoPlayback({ endState }: { endState: DemoEndState }) {
  const { t } = useTranslation(['collaborationDemo'])
  const messageContent = useMessageContent()
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)', { noSsr: true })
  const playback = usePlayback(demoDuration)
  const fitViewport = useFitDemoViewport()
  const [threadOpen, setThreadOpen] = useState(true)
  const [threadReopened, setThreadReopened] = useState(false)
  const frame = getPlaybackFrame(playback.seconds, reducedMotion)

  useHotkey('Escape', playback.pause, { enabled: playback.playing })

  const changeThreadOpen = (open: boolean, fromMarker: boolean) => {
    if (!open) playback.pause()
    setThreadReopened(fromMarker)
    setThreadOpen(open)
  }
  const resume = () => {
    setThreadReopened(false)
    setThreadOpen(true)
    playback.play()
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
            {t(($) => $['playback.messageLine'], {
              author: demoUsers[message.author].name,
              message: messageContent(message),
            })}
          </p>
        ))}
      </div>
      <DemoCanvasLayer
        frame={frame}
        markerInteractive={!playback.playing}
        finished={playback.finished}
        reducedMotion={reducedMotion}
        threadOpen={threadOpen}
        onThreadOpenChange={changeThreadOpen}
        focusThread={threadReopened}
      />
      {playback.finished ? (
        <DemoEndPanel
          state={endState}
          onReplay={() => {
            setThreadOpen(true)
            setThreadReopened(false)
            fitViewport()
            playback.restart()
          }}
        />
      ) : (
        <div
          data-role="demo-controls"
          className="pointer-events-auto absolute inset-x-0 bottom-4 z-20 mx-auto flex w-fit items-center gap-1 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-1 shadow-lg"
        >
          <Button
            ref={focusOnMount}
            variant="ghost"
            onClick={playback.playing ? playback.pause : resume}
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
