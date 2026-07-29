'use client'

import type { DeploymentDialogRequest } from './deployment-dialog/types'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BuiltInEnvironmentCard } from './built-in-environment-card'
import { DeploymentDialog } from './deployment-dialog'
import { EnvironmentTable } from './environment-table'
import { BUILT_IN_ENVIRONMENT } from './mock-data'

export default function AppDeploy() {
  const { t } = useTranslation('deployments')
  const { t: tCommon } = useTranslation('common')
  const [deploymentRequest, setDeploymentRequest] = useState<DeploymentDialogRequest>()

  return (
    <>
      <main className="flex h-full flex-col bg-components-panel-bg">
        <header className="shrink-0 px-6 pt-3 pb-2">
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

        <div className="flex min-h-0 grow flex-col gap-4 px-6 py-2">
          <BuiltInEnvironmentCard />
          <EnvironmentTable
            onDeployToEnvironment={(environment) =>
              setDeploymentRequest({
                currentVersion: BUILT_IN_ENVIRONMENT.version.name,
                environment,
                kind: 'deploy',
              })
            }
            onChangeVersion={(deployment) =>
              setDeploymentRequest({
                currentVersion: deployment.version?.name,
                environment: deployment.name,
                kind: 'changeVersion',
              })
            }
            onUndeploy={() => {}}
          />
        </div>
      </main>
      <DeploymentDialog
        request={deploymentRequest}
        onClose={() => setDeploymentRequest(undefined)}
      />
    </>
  )
}
