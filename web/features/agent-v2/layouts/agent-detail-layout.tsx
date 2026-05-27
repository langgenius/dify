'use client'

import type { ReactNode } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { useTranslation } from 'react-i18next'
import useDocumentTitle from '@/hooks/use-document-title'

type AgentDetailLayoutProps = {
  agentId: string
  children: ReactNode
}

export function AgentDetailLayout({
  agentId,
  children,
}: AgentDetailLayoutProps) {
  const { t } = useTranslation('agentV2')

  useDocumentTitle(t('agentDetail.documentTitle'))

  return (
    <main className="flex h-full min-w-0 flex-col overflow-hidden bg-background-section">
      <header className="flex h-20 shrink-0 items-center justify-between border-b border-divider-subtle bg-background-body px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-text-accent text-text-primary-on-surface shadow-xs">
            <span aria-hidden className="i-custom-vender-solid-mediaAndDevices-robot size-5" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate title-xl-semi-bold text-text-primary">
              {t('agentDetail.title')}
            </h1>
            <p className="mt-1 truncate system-xs-regular text-text-tertiary">
              {t('agentDetail.subtitle', { agentId })}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="primary" className="gap-1.5" disabled>
            {t('agentDetail.publish')}
            <span aria-hidden className="i-ri-arrow-down-s-line size-4" />
          </Button>
          <Button className="px-2.5" aria-label={t('agentDetail.history')}>
            <span aria-hidden className="i-ri-history-line size-4" />
          </Button>
        </div>
      </header>
      <div className="min-h-0 min-w-0 flex-1 overflow-auto">
        {children}
      </div>
    </main>
  )
}
