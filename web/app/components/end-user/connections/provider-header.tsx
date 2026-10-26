'use client'

import type { ConnectionProvider } from './model'
import { useTranslation } from 'react-i18next'
import Link from '@/next/link'
import ProviderIcon from './provider-icon'

export default function ProviderHeader({ provider }: { provider: ConnectionProvider }) {
  const { t } = useTranslation(['app'])

  return (
    <header className="flex flex-col items-start gap-4 px-5 pt-3.5 pb-4 sm:px-8">
      <Link
        href="/connections"
        className="inline-flex items-center gap-1 rounded-md system-sm-medium text-text-tertiary hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
      >
        <span className="i-ri-arrow-left-line size-3.5" aria-hidden="true" />
        {t(($) => $['endUser.connections'], { ns: 'app' })}
      </Link>
      <div className="flex min-w-0 items-center gap-4">
        <ProviderIcon provider={provider} size="large" />
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="title-3xl-semi-bold wrap-anywhere text-text-primary">{provider.name}</h1>
          <p className="system-sm-regular text-text-tertiary">
            {t(($) => $['endUser.providerConnectionsDescription'], {
              ns: 'app',
              provider: provider.name,
            })}
          </p>
        </div>
      </div>
    </header>
  )
}
