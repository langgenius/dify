'use client'

import type { ConnectionAuthState } from './mock-data'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import { DifyLogo } from '@/app/components/base/logo/dify-logo'
import { MAIN_CONTENT_ID, SkipLink } from '@/app/components/main-nav/skip-link'
import useDocumentTitle from '@/hooks/use-document-title'
import RequiredServices from '../connections/required-services'
import ConnectionAuthCompletion from './completion'
import ConnectionAuthIssue from './issue'
import { mockRequest } from './mock-data'
import RequestContextItem from './request-context-item'
import useMockConnections from './use-mock-connections'

function ConnectionAuthSession({ linkState }: { linkState: ConnectionAuthState }) {
  const { t } = useTranslation(['share', 'common'])
  const titleId = useId()
  const { services, connectedCount, ready, ...actions } = useMockConnections()
  const [finished, setFinished] = useState(false)
  const { requester, identity } = mockRequest
  const progressOptions = {
    ns: 'share' as const,
    source: requester,
    connected: connectedCount,
    total: services.length,
  }
  const progressMessage = t(($) => $['connections.headless.apiProgress'], progressOptions)
  useDocumentTitle(t(($) => $['connections.headless.title'], { ns: 'share' }))

  return (
    <div className="flex min-h-dvh flex-col bg-linear-to-b from-background-default-hover/90 to-background-body/90">
      <SkipLink>{t(($) => $['navigation.skipToMain'], { ns: 'common' })}</SkipLink>
      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className="flex flex-1 items-center justify-center px-6 py-12 focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden focus-visible:ring-inset"
      >
        <div className="flex w-full max-w-150 flex-col gap-6">
          <div className="flex flex-col gap-3">
            <AppIcon
              size="xxl"
              fallback={{
                content: (
                  <span
                    className={cn(
                      'size-8 text-text-primary-on-surface',
                      mockRequest.app.iconClassName,
                    )}
                  />
                ),
                background: mockRequest.app.iconBackground,
              }}
            />
            <div className="space-y-2">
              <h1 className="system-xl-semibold wrap-anywhere text-text-primary">
                {mockRequest.app.name}
              </h1>
              <p className="system-xs-regular wrap-anywhere text-text-tertiary">
                {mockRequest.app.description}
              </p>
            </div>
          </div>
          {linkState !== 'setup' ? (
            <ConnectionAuthIssue state={linkState} requester={requester} />
          ) : finished ? (
            <ConnectionAuthCompletion services={services} requester={requester} />
          ) : (
            <>
              <div className="divide-y divide-divider-subtle overflow-hidden rounded-2xl border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg">
                <RequestContextItem
                  iconClassName="i-ri-message-3-line"
                  text={t(($) => $['connections.headless.requestedFrom'], {
                    ns: 'share',
                    source: requester,
                  })}
                />
                <RequestContextItem
                  iconClassName="i-ri-shield-user-line"
                  text={t(($) => $['connections.headless.signedInAs'], {
                    ns: 'share',
                    identity,
                  })}
                />
              </div>
              <section aria-labelledby={titleId} className="flex flex-col gap-6">
                <div className="space-y-2">
                  <h2 id={titleId} className="title-2xl-semi-bold text-text-primary">
                    {t(($) => $['connections.headless.title'], { ns: 'share' })}
                  </h2>
                  <p role="status" className="min-h-5 system-xs-regular text-text-tertiary">
                    {ready
                      ? t(($) => $['connections.headless.allConnected'], {
                          ns: 'share',
                          count: services.length,
                        })
                      : progressMessage}
                  </p>
                </div>
                <RequiredServices services={services} {...actions} />
              </section>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <p className="flex min-w-0 flex-1 items-center gap-1.5 ps-1 system-xs-regular text-text-tertiary">
                  <span className="i-ri-lock-line size-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    {t(($) => $['connections.headless.security'], {
                      ns: 'share',
                      source: requester,
                    })}
                  </span>
                </p>
                <Button
                  variant="primary"
                  disabled={!ready}
                  onClick={() => {
                    if (ready) setFinished(true)
                  }}
                >
                  {t(($) => $['connections.headless.finishSetup'], { ns: 'share' })}
                </Button>
              </div>
            </>
          )}
        </div>
      </main>
      <footer className="flex items-center justify-center gap-1.5 px-6 pt-4 pb-6">
        <span className="system-2xs-medium-uppercase text-text-tertiary">
          {t(($) => $['chat.poweredBy'], { ns: 'share' })}
        </span>
        <DifyLogo alt="Dify" size="small" />
      </footer>
    </div>
  )
}

export default function ConnectionAuth({
  appId,
  linkState = 'setup',
}: {
  appId: string
  linkState?: ConnectionAuthState
}) {
  return <ConnectionAuthSession key={`${appId}:${linkState}`} linkState={linkState} />
}
