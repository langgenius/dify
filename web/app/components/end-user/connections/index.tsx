'use client'

import type { ConnectionProvider } from './model'
import { useTranslation } from 'react-i18next'
import Link from '@/next/link'
import ProviderIcon from './provider-icon'

type Props = {
  providers: readonly ConnectionProvider[]
}

export default function Connections({ providers }: Props) {
  const { t } = useTranslation(['app'])

  return (
    <>
      <header className="flex flex-col gap-1 px-5 pt-3.5 pb-5 sm:px-8">
        <h1 className="title-3xl-semi-bold text-text-primary">
          {t(($) => $['endUser.myConnections'], { ns: 'app' })}
        </h1>
        <p className="body-sm-regular text-text-secondary">
          {t(($) => $['endUser.connectionsDescription'], { ns: 'app' })}
        </p>
      </header>
      <ul className="grid grid-cols-1 gap-3 px-5 pb-8 sm:px-8 lg:grid-cols-2 xl:grid-cols-3">
        {providers.map((provider) => (
          <li key={provider.id}>
            <Link
              href={`/connections/${encodeURIComponent(provider.id)}`}
              className="flex min-w-0 items-center gap-6 rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg p-4 shadow-xs hover:bg-components-panel-on-panel-item-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
            >
              <div className="flex min-w-0 flex-1 items-center gap-4">
                <ProviderIcon provider={provider} />
                <div className="min-w-0 flex-1">
                  <h2 className="system-xl-semibold leading-5 wrap-anywhere text-text-secondary">
                    {provider.name}
                  </h2>
                  <p className="mt-0.5 truncate system-sm-regular text-text-tertiary">
                    {provider.description}
                  </p>
                </div>
              </div>
              <span
                className="flex size-6 shrink-0 items-center justify-center text-text-tertiary"
                aria-hidden="true"
              >
                <span className="i-ri-arrow-right-s-line size-4" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}
