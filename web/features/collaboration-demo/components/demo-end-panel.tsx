'use client'

import type { DemoEndState } from '../end-state'
import { Button, buttonVariants } from '@langgenius/dify-ui/button'
import { useAtomValue } from 'jotai'
import { useQueryState } from 'nuqs'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  pricingQueryParamName,
  pricingQueryParser,
} from '@/app/components/billing/pricing/query-params'
import { trackCollabUpgradePrompt } from '@/app/components/workflow/collaboration/analytics'
import { currentWorkspaceIdAtom } from '@/context/workspace-state'
import Link from '@/next/link'
import { useRouter } from '@/next/navigation'

type DemoEndPanelProps = {
  state: DemoEndState
  onReplay: () => void
  onExit: () => void
}

export function DemoEndPanel({ state, onReplay, onExit }: DemoEndPanelProps) {
  const { t } = useTranslation(['collaborationDemo'])
  const router = useRouter()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const upgradeRef = useRef<HTMLButtonElement>(null)
  const [pricing, setPricing] = useQueryState(pricingQueryParamName, pricingQueryParser)
  const pricingWasOpenRef = useRef(false)
  const primaryLink = buttonVariants({ variant: 'primary', size: 'medium' })
  const workspaceId = useAtomValue(currentWorkspaceIdAtom)
  const upgradeShownRef = useRef(false)

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  useEffect(() => {
    if (pricing === 'open') pricingWasOpenRef.current = true
    else if (pricingWasOpenRef.current) {
      pricingWasOpenRef.current = false
      upgradeRef.current?.focus()
    }
  }, [pricing])

  const { kind } = state

  useEffect(() => {
    if (kind !== 'upgrade' || upgradeShownRef.current) return
    upgradeShownRef.current = true
    trackCollabUpgradePrompt({
      action: 'shown',
      entry_point: 'tour_end',
      workspace_id: workspaceId,
    })
  }, [kind, workspaceId])
  const title =
    kind === 'upgrade' || kind === 'upgradeContactAdmin'
      ? t(($) => $['end.upgrade.title'])
      : kind === 'unavailable'
        ? t(($) => $['end.unavailable.title'])
        : t(($) => $['end.enabled.title'])

  const description = {
    loading: t(($) => $['end.loading']),
    enabled: t(($) => $['end.enabled.description']),
    upgrade: t(($) => $['end.upgrade.description']),
    upgradeContactAdmin: t(($) => $['end.upgrade.contactAdmin']),
    unavailable: t(($) => $['end.unavailable.description']),
  }[kind]

  const studioLabel = t(($) => $['end.goToStudio'])
  const upgradeLabel = t(($) => $['end.upgrade.action'])
  const readyAction = kind === 'enabled' ? studioLabel : kind === 'upgrade' ? upgradeLabel : null
  const unavailable = kind === 'unavailable'

  return (
    <section
      data-role="demo-controls"
      aria-labelledby="collaboration-demo-end-title"
      aria-describedby="collaboration-demo-end-description"
      className="pointer-events-auto absolute inset-x-0 bottom-4 z-20 mx-auto w-100 max-w-[calc(100%-32px)] rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-5 shadow-xl motion-safe:transition-opacity motion-safe:duration-300 motion-safe:starting:opacity-0"
    >
      <h2
        id="collaboration-demo-end-title"
        ref={headingRef}
        tabIndex={-1}
        className="title-xl-semi-bold text-text-primary outline-hidden"
      >
        {title}
      </h2>
      <p
        id="collaboration-demo-end-description"
        className="mt-1 system-sm-regular text-text-secondary"
      >
        {description}
      </p>
      <span aria-live="polite" className="sr-only">
        {readyAction && t(($) => $['end.ready'], { action: readyAction })}
      </span>
      <div className="mt-5 flex flex-wrap items-center gap-2">
        {kind === 'enabled' && (
          <Link href="/apps" className={primaryLink}>
            {studioLabel}
          </Link>
        )}
        {kind === 'upgrade' && (
          <Button
            ref={upgradeRef}
            variant="primary"
            onClick={() => {
              trackCollabUpgradePrompt({
                action: 'upgrade_clicked',
                entry_point: 'tour_end',
                workspace_id: workspaceId,
              })
              void setPricing('open')
            }}
          >
            {upgradeLabel}
          </Button>
        )}
        <Button
          variant={unavailable ? 'primary' : undefined}
          onClick={unavailable ? () => router.replace('/apps') : onExit}
        >
          {unavailable ? t(($) => $['end.backToWorkspace']) : t(($) => $['end.close'])}
        </Button>
        <Button variant="ghost" onClick={onReplay}>
          <span aria-hidden className="i-ri-restart-line size-4" />
          {t(($) => $['playback.replay'])}
        </Button>
      </div>
    </section>
  )
}
