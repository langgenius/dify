'use client'

import type { DemoEndState } from '../end-state'
import { Button, buttonVariants } from '@langgenius/dify-ui/button'
import { useMergedRefs } from '@langgenius/dify-ui/use-merged-refs'
import { useQueryState } from 'nuqs'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { createWorkflowAppHref } from '@/app/components/apps/query-params'
import {
  pricingQueryParamName,
  pricingQueryParser,
} from '@/app/components/billing/pricing/query-params'
import Link from '@/next/link'
import { useRouter } from '@/next/navigation'
import { useExitDemo } from '../use-exit-demo'

type DemoEndPanelProps = {
  state: DemoEndState
  onReplay: () => void
}

export function DemoEndPanel({ state, onReplay }: DemoEndPanelProps) {
  const { t } = useTranslation(['collaborationDemo'])
  const router = useRouter()
  const exitDemo = useExitDemo()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const upgradeRef = useRef<HTMLButtonElement>(null)
  const [pricing, setPricing] = useQueryState(pricingQueryParamName, pricingQueryParser)
  const pricingWasOpenRef = useRef(false)
  const pendingPrimaryFocusedRef = useRef(false)
  const focusReadyPrimary = (element: HTMLElement | null) => {
    if (!element || !pendingPrimaryFocusedRef.current) return
    pendingPrimaryFocusedRef.current = false
    element.focus()
  }
  const upgradeButtonRef = useMergedRefs(upgradeRef, focusReadyPrimary)
  const primaryLink = buttonVariants({ variant: 'primary', size: 'medium' })

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
  const tryNowLabel = t(($) => $['end.enabled.action'])
  const title =
    kind === 'upgrade' || kind === 'upgradeContactAdmin'
      ? t(($) => $['end.upgrade.title'])
      : kind === 'unavailable'
        ? t(($) => $['end.unavailable.title'])
        : t(($) => $['end.enabled.title'])

  const description =
    state.kind === 'tryNow'
      ? t(($) => $['end.enabled.latestApp'], { name: state.app.name })
      : state.kind === 'readOnly'
        ? state.role === 'datasetOperator'
          ? t(($) => $['end.readOnly.datasetOperator'])
          : t(($) => $['end.readOnly.normal'])
        : {
            loading: t(($) => $['end.loading']),
            appsLoading: t(($) => $['end.enabled.description']),
            appsError: t(($) => $['end.enabled.description']),
            createApp: t(($) => $['end.noApps']),
            upgrade: t(($) => $['end.upgrade.description']),
            upgradeContactAdmin: t(($) => $['end.upgrade.contactAdmin']),
            unavailable: t(($) => $['end.unavailable.description']),
          }[state.kind]

  const readyAction =
    kind === 'tryNow'
      ? tryNowLabel
      : kind === 'appsError'
        ? t(($) => $['end.goToStudio'])
        : kind === 'createApp'
          ? t(($) => $['end.createWorkflow'])
          : kind === 'upgrade'
            ? t(($) => $['end.upgrade.action'])
            : undefined

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
        {(kind === 'loading' || kind === 'appsLoading') && (
          <Button
            variant="primary"
            loading
            onFocus={() => {
              pendingPrimaryFocusedRef.current = true
            }}
            onBlur={() => {
              pendingPrimaryFocusedRef.current = false
            }}
          >
            {tryNowLabel}
          </Button>
        )}
        {state.kind === 'tryNow' && (
          <Link
            ref={focusReadyPrimary}
            href={`/app/${state.app.id}/workflow`}
            className={primaryLink}
          >
            {tryNowLabel}
          </Link>
        )}
        {kind === 'appsError' && (
          <Link ref={focusReadyPrimary} href="/apps" className={primaryLink}>
            {t(($) => $['end.goToStudio'])}
          </Link>
        )}
        {kind === 'createApp' && (
          <Link ref={focusReadyPrimary} href={createWorkflowAppHref} className={primaryLink}>
            {t(($) => $['end.createWorkflow'])}
          </Link>
        )}
        {kind === 'upgrade' && (
          <Button ref={upgradeButtonRef} variant="primary" onClick={() => setPricing('open')}>
            {t(($) => $['end.upgrade.action'])}
          </Button>
        )}
        {kind === 'unavailable' ? (
          <Button ref={focusReadyPrimary} variant="primary" onClick={() => router.replace('/apps')}>
            {t(($) => $['end.backToWorkspace'])}
          </Button>
        ) : (
          <Button onClick={exitDemo}>{t(($) => $['end.close'])}</Button>
        )}
        <Button variant="ghost" onClick={onReplay}>
          <span aria-hidden className="i-ri-restart-line size-4" />
          {t(($) => $['playback.replay'])}
        </Button>
      </div>
    </section>
  )
}
