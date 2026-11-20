'use client'

import type { DemoEndState } from '../end-state'
import { Button, buttonVariants } from '@langgenius/dify-ui/button'
import { useQueryState } from 'nuqs'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  pricingQueryParamName,
  pricingQueryParser,
} from '@/app/components/billing/pricing/query-params'
import Link from '@/next/link'

type DemoEndPanelProps = {
  state: DemoEndState
  onReplay: () => void
  onClose: () => void
}

export function DemoEndPanel({ state, onReplay, onClose }: DemoEndPanelProps) {
  const { t } = useTranslation(['collaborationDemo'])
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [, setPricing] = useQueryState(pricingQueryParamName, pricingQueryParser)
  const primaryLink = buttonVariants({ variant: 'primary', size: 'medium' })

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  const upgradeLike = state === 'upgrade' || state === 'upgradeContactAdmin'
  const enabledLike =
    state === 'tryNow' || state === 'createApp' || state === 'noApps' || state === 'noAccess'

  const title = upgradeLike
    ? t(($) => $['end.upgrade.title'])
    : enabledLike || state === 'loading'
      ? t(($) => $['end.enabled.title'])
      : t(($) => $['end.unavailable.title'])

  const description = {
    loading: t(($) => $['end.enabled.description']),
    tryNow: t(($) => $['end.enabled.description']),
    createApp: t(($) => $['end.enabled.description']),
    noApps: t(($) => $['end.noApps.description']),
    noAccess: t(($) => $['end.noAccess.description']),
    upgrade: t(($) => $['end.upgrade.description']),
    upgradeContactAdmin: t(($) => $['end.upgrade.contactAdmin']),
    unavailable: t(($) => $['end.unavailable.description']),
  }[state]

  return (
    <section
      aria-labelledby="collaboration-demo-end-title"
      className="pointer-events-auto absolute bottom-6 left-1/2 z-20 w-100 max-w-[calc(100%-32px)] -translate-x-1/2 rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-5 shadow-xl transition-[opacity,translate] duration-300 motion-reduce:transition-none starting:translate-y-2 starting:opacity-0"
    >
      <h2
        id="collaboration-demo-end-title"
        ref={headingRef}
        tabIndex={-1}
        className="title-xl-semi-bold text-text-primary outline-hidden"
      >
        {title}
      </h2>
      <p className="mt-1 system-sm-regular text-text-secondary">{description}</p>
      <div className="mt-5 flex items-center justify-between gap-2">
        <Button variant="ghost" onClick={onReplay}>
          <span aria-hidden className="i-ri-replay-line size-4" />
          {t(($) => $['playback.replay'])}
        </Button>
        <div className="flex items-center gap-2">
          {state === 'unavailable' ? (
            <Link href="/apps" className={primaryLink}>
              {t(($) => $['end.backToWorkspace'])}
            </Link>
          ) : (
            <Button onClick={onClose}>{t(($) => $['end.close'])}</Button>
          )}
          {state === 'tryNow' && (
            <Link href="/apps?category=workflow" className={primaryLink}>
              {t(($) => $['end.enabled.action'])}
            </Link>
          )}
          {state === 'createApp' && (
            <Link href="/apps" className={primaryLink}>
              {t(($) => $['end.noApps.create'])}
            </Link>
          )}
          {state === 'upgrade' && (
            <Button variant="primary" onClick={() => setPricing('open')}>
              {t(($) => $['end.upgrade.action'])}
            </Button>
          )}
        </div>
      </div>
    </section>
  )
}
