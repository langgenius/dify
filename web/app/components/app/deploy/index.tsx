'use client'

import { useTranslation } from 'react-i18next'
import { BuiltInEnvironmentCard } from './built-in-environment-card'
import { EnvironmentTable } from './environment-table'

export default function AppDeploy() {
  const { t } = useTranslation('deployments')
  const { t: tCommon } = useTranslation('common')

  return (
    <main className="h-full flex flex-col bg-components-panel-bg">
      <header className="px-6 pt-3 pb-2 shrink-0">
        <h1 className="title-xl-semi-bold text-text-primary">
          {tCommon(($) => $['appMenus.deploy'])}
        </h1>
        <p className="flex items-center gap-x-1 system-xs-regular text-text-tertiary">
          <span>{t(($) => $['studio.description'])}</span>
          <a
            href="https://docs.dify.ai/"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center text-text-accent hover:underline focus-visible:ring-1 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          >
            {tCommon(($) => $['operation.learnMore'])}
            <span aria-hidden className="i-ri-arrow-right-up-line size-3" />
          </a>
        </p>
      </header>

      <div className="flex flex-col gap-4 px-6 py-2 grow min-h-0">
        <BuiltInEnvironmentCard />
        <EnvironmentTable />
      </div>
    </main>
  )
}
