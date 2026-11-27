'use client'

import type { TourOutcome } from '../analytics'
import type { DemoEndState } from '../end-state'
import { Button } from '@langgenius/dify-ui/button'
import { useMediaQuery } from '@langgenius/dify-ui/use-media-query'
import { useHotkey } from '@tanstack/react-hotkeys'
import { useEffect, useEffectEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import WorkflowPreview from '@/app/components/workflow/workflow-preview'
import { createDemoGraph } from '../demo-graph'
import { demoUsers } from '../demo-users'
import { DemoViewportFit } from '../demo-viewport'
import { demoDuration, demoMessages, getPlaybackFrame } from '../playback-script'
import { useMessageContent } from '../use-message-content'
import { usePlayback } from '../use-playback'
import { DemoCanvasLayer } from './demo-canvas-layer'
import { DemoEndPanel } from './demo-end-panel'

const focusOnMount = (element: HTMLElement | null) => element?.focus()

type DemoStageProps = {
  /** Whether the guide has handed over to playback. */
  playing: boolean
  endState: DemoEndState
  onOutcome: (outcome: TourOutcome) => void
  onExit: () => void
}

/**
 * The demo canvas and its playback: what moves with the canvas renders inside React Flow, and
 * the controls, end panel and message log beside it.
 */
export function DemoStage({ playing, endState, onOutcome, onExit }: DemoStageProps) {
  const { t } = useTranslation(['collaborationDemo'])
  const messageContent = useMessageContent()
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)', { noSsr: true })
  const playback = usePlayback(demoDuration, playing)
  const [replays, setReplays] = useState(0)
  const [threadOpen, setThreadOpen] = useState(true)
  const [threadReopened, setThreadReopened] = useState(false)
  const frame = getPlaybackFrame(playback.seconds, reducedMotion)

  useHotkey('Escape', playback.pause, { enabled: playback.playing })

  const onFinished = useEffectEvent(() => onOutcome({ action: 'tour_completed' }))
  useEffect(() => {
    if (playback.finished) onFinished()
  }, [playback.finished])

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
      <WorkflowPreview
        {...createDemoGraph({
          start: t(($) => $['nodes.start']),
          checkOrder: t(($) => $['nodes.checkOrder']),
          lookupRefund: t(($) => $['nodes.lookupRefund']),
          generateReply: t(($) => $['nodes.generateReply']),
          refundStatus: t(($) => $['nodes.refundStatus']),
          askOrder: t(($) => $['nodes.askOrder']),
        })}
        miniMapToRight
      >
        <DemoViewportFit key={replays} />
        {playing && (
          <DemoCanvasLayer
            frame={frame}
            markerInteractive={!playback.playing}
            finished={playback.finished}
            reducedMotion={reducedMotion}
            threadOpen={threadOpen}
            onThreadOpenChange={changeThreadOpen}
            focusThread={threadReopened}
          />
        )}
      </WorkflowPreview>
      {playing && (
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
          {playback.finished ? (
            <DemoEndPanel
              state={endState}
              onExit={onExit}
              onReplay={() => {
                setThreadOpen(true)
                setThreadReopened(false)
                setReplays((count) => count + 1)
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
              <Button
                variant="ghost"
                onClick={() => {
                  onOutcome({ action: 'tour_skipped', step: 'playback' })
                  playback.skip()
                }}
              >
                {t(($) => $['playback.skip'])}
              </Button>
            </div>
          )}
        </>
      )}
    </>
  )
}
