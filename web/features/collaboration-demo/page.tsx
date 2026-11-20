'use client'

import { Button } from '@langgenius/dify-ui/button'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Toggle } from '@langgenius/dify-ui/toggle'
import { useMediaQuery } from '@langgenius/dify-ui/use-media-query'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import WorkflowPreview from '@/app/components/workflow/workflow-preview'
import { currentWorkspaceAtom } from '@/context/workspace-state'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { DemoCanvasLayer } from './components/demo-canvas-layer'
import { DemoEndPanel } from './components/demo-end-panel'
import { DemoMembers } from './components/demo-members'
import { DemoStepGuide } from './components/demo-step-guide'
import { createDemoGraph } from './demo-graph'
import { getDemoEndState, getTryNowHref } from './end-state'
import { demoDuration, getPlaybackFrame } from './playback-script'
import { usePlayback } from './use-playback'

type Step = 'members' | 'comment' | 'playing'

function useCollaborativeAppCounts(enabled: boolean) {
  const query = (mode: 'workflow' | 'advanced-chat') =>
    consoleQuery.apps.get.queryOptions({
      input: { query: { page: 1, limit: 1, mode } },
      enabled,
    })
  const workflows = useQuery(query('workflow'))
  const chatflows = useQuery(query('advanced-chat'))
  if (!workflows.data || !chatflows.data) return undefined
  return { workflows: workflows.data.total, chatflows: chatflows.data.total }
}

export default function CollaborationDemoPage() {
  const { t } = useTranslation(['collaborationDemo'])
  const router = useRouter()
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)', { noSsr: true })
  const [step, setStep] = useState<Step>('members')
  const [membersOpen, setMembersOpen] = useState(false)
  const [membersTarget, setMembersTarget] = useState<HTMLButtonElement | null>(null)
  const [commentTarget, setCommentTarget] = useState<HTMLButtonElement | null>(null)
  const playback = usePlayback(demoDuration)

  const graph = useMemo(
    () =>
      createDemoGraph({
        start: t(($) => $['nodes.start']),
        checkOrder: t(($) => $['nodes.checkOrder']),
        lookupRefund: t(($) => $['nodes.lookupRefund']),
        generateReply: t(($) => $['nodes.generateReply']),
        refundStatus: t(($) => $['nodes.refundStatus']),
        askOrder: t(($) => $['nodes.askOrder']),
      }),
    [t],
  )

  const features = useQuery(consoleQuery.features.get.queryOptions())
  const role = useAtomValue(currentWorkspaceAtom).role
  const collaborationEnabled = features.data?.workflow_collaboration_enabled === true
  const appCounts = useCollaborativeAppCounts(collaborationEnabled)
  const endState = getDemoEndState({
    features: features.data
      ? {
          status: 'success',
          collaborationEnabled,
          upgradeAvailable: features.data.workflow_collaboration_upgrade_available === true,
        }
      : features.isError
        ? { status: 'error' }
        : { status: 'pending' },
    role,
    hasCollaborativeApps: appCounts && appCounts.workflows + appCounts.chatflows > 0,
  })

  const startPlayback = () => {
    setStep('playing')
    playback.restart()
  }
  const exitDemo = () => {
    window.close()
    router.push('/apps')
  }

  const frame = step === 'playing' ? getPlaybackFrame(playback.seconds, reducedMotion) : undefined

  return (
    <div className="flex h-full min-h-0 flex-col bg-background-body">
      <div className="relative min-h-0 flex-1">
        <WorkflowPreview {...graph} miniMapToRight>
          <DemoCanvasLayer frame={frame} playing={playback.playing} />
        </WorkflowPreview>

        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex h-14 items-center justify-between px-3">
          <h1 className="pointer-events-auto system-md-semibold text-text-primary">
            {t(($) => $.title)}
          </h1>
          <div className="pointer-events-auto flex items-center gap-2">
            <DemoMembers
              open={membersOpen}
              onOpenChange={setMembersOpen}
              triggerRef={setMembersTarget}
            />
            <Button onClick={exitDemo}>{t(($) => $.exit)}</Button>
          </div>
        </div>

        <div className="absolute inset-s-3 top-14 z-10 flex flex-col items-center rounded-lg border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 text-text-tertiary shadow-lg">
          <Toggle
            pressed={step === 'playing'}
            onPressedChange={(pressed) => pressed && startPlayback()}
            disabled={step === 'playing'}
            className="data-pressed:bg-state-accent-active data-pressed:text-text-accent"
            render={
              <IconButton
                ref={setCommentTarget}
                size="lg"
                aria-label={t(($) => $.commentTool)}
                className="rounded-md"
              >
                <span aria-hidden className="i-custom-public-other-comment size-4" />
              </IconButton>
            }
          />
        </div>

        {step === 'playing' && !playback.finished && (
          <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-1 shadow-lg">
            <Button variant="ghost" onClick={playback.playing ? playback.pause : playback.play}>
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

        {step === 'playing' && playback.finished && (
          <DemoEndPanel
            state={endState}
            tryNowHref={appCounts ? getTryNowHref(appCounts) : '/apps'}
            onReplay={playback.restart}
            onClose={exitDemo}
          />
        )}

        {step !== 'playing' && (
          <DemoStepGuide
            step={step}
            target={step === 'members' ? membersTarget : commentTarget}
            highlightSelectors={
              step === 'members' && membersOpen ? ['[data-collaboration-demo-members]'] : undefined
            }
            onAction={() => {
              if (step === 'comment') return startPlayback()
              setMembersOpen(false)
              setStep('comment')
            }}
            onExit={exitDemo}
          />
        )}
      </div>
    </div>
  )
}
