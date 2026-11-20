'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useMediaQuery } from '@langgenius/dify-ui/use-media-query'
import { useHotkey } from '@tanstack/react-hotkeys'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { demoDuration, getPlaybackFrame } from '../playback-script'
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

  useHotkey('Escape', playback.pause, { enabled: playback.playing })

  const changeThreadOpen = (open: boolean) => {
    reopenedRef.current = open
    setThreadOpen(open)
  }
  const focusReopenedThread = (element: HTMLButtonElement | null) => {
    if (!element || !reopenedRef.current) return
    reopenedRef.current = false
    element.focus()
  }

  return (
    <>
      <DemoCanvasLayer
        frame={getPlaybackFrame(playback.seconds, reducedMotion)}
        playing={playback.playing}
        reducedMotion={reducedMotion}
        threadOpen={threadOpen}
        onThreadOpenChange={changeThreadOpen}
        markerRef={focusOnMount}
        threadCloseRef={focusReopenedThread}
      />
      {playback.finished ? (
        <DemoEndPanel
          onReplay={() => {
            setThreadOpen(true)
            playback.restart()
          }}
        />
      ) : (
        <div className="pointer-events-auto absolute inset-x-0 bottom-12 z-20 mx-auto flex w-fit items-center gap-1 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-1 shadow-lg">
          <Button
            ref={focusOnMount}
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
