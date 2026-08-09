'use client'

import type {
  AppEnvironment,
  EnvironmentDeployment,
} from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { UndeployHandler } from './types'
import { cn } from '@langgenius/dify-ui/cn'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import {
  appEnvironmentDeploymentsAtom,
  appEnvironmentDeploymentsIsErrorAtom,
  appEnvironmentDeploymentsIsFetchingAtom,
  appEnvironmentDeploymentsIsLoadingAtom,
  appEnvironmentDeploymentsRefetchAtom,
  appEnvironmentUsageAtom,
} from '../state'
import { EnvironmentDeployMenu } from './deploy-menu'
import { EnvironmentTableEmpty } from './empty-state'
import { EnvironmentRow } from './row'

type EnvironmentTableProps = {
  appId: string
  onChangeVersion?: (deployment: EnvironmentDeployment) => void
  onDeployLatest?: (deployment: EnvironmentDeployment) => void
  onDeployToEnvironment?: (environment: AppEnvironment) => void
  onRedeploy?: (deployment: EnvironmentDeployment) => void
  onUndeploy?: UndeployHandler
}

export function EnvironmentTable({
  appId,
  onChangeVersion,
  onDeployLatest,
  onDeployToEnvironment,
  onRedeploy,
  onUndeploy,
}: EnvironmentTableProps) {
  const { t } = useTranslation('deployments')
  const deployments = useAtomValue(appEnvironmentDeploymentsAtom) ?? []
  const isLoading = useAtomValue(appEnvironmentDeploymentsIsLoadingAtom)
  const isError = useAtomValue(appEnvironmentDeploymentsIsErrorAtom)
  const isFetching = useAtomValue(appEnvironmentDeploymentsIsFetchingAtom)
  const refetchDeployments = useAtomValue(appEnvironmentDeploymentsRefetchAtom)
  const usage = useAtomValue(appEnvironmentUsageAtom)
  const used = usage?.used ?? deployments.length
  const total = usage?.total ?? deployments.length
  const showLoadingState = isLoading && deployments.length === 0
  const showErrorState = isError && deployments.length === 0
  const isRetrying = showErrorState && isFetching
  const showEmptyState = !isLoading && !isError && deployments.length === 0

  return (
    <section
      aria-labelledby="deploy-environments-title"
      aria-busy={showLoadingState || isRetrying}
      className="flex min-h-0 grow flex-col gap-3"
    >
      <div className="flex shrink-0 items-center justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <h2
            id="deploy-environments-title"
            className="truncate system-md-semibold text-text-primary"
          >
            {t(($) => $['studio.environments'])}
          </h2>
          <span aria-hidden className="system-xs-regular text-text-quaternary">
            ·
          </span>
          <span className="truncate system-xs-regular text-text-tertiary">
            {t(($) => $['studio.environmentsInUse'], {
              total,
              used,
            })}
          </span>
        </div>
        <EnvironmentDeployMenu onSelectEnvironment={onDeployToEnvironment} />
      </div>

      <div
        className={cn(
          'min-h-0 w-full grow overflow-y-auto',
          deployments.length > 0 ? 'overflow-x-auto' : 'overflow-x-hidden',
        )}
      >
        {showLoadingState ? (
          <Loading className="h-full" />
        ) : showErrorState ? (
          <EnvironmentTableEmpty
            state="error"
            isRetrying={isRetrying}
            onRetry={() => void refetchDeployments()}
          />
        ) : showEmptyState ? (
          <EnvironmentTableEmpty state="empty" onSelectEnvironment={onDeployToEnvironment} />
        ) : (
          <table className="w-full min-w-260 table-fixed border-separate border-spacing-0">
            <colgroup>
              <col className="w-43" />
              <col className="w-46" />
              <col className="w-44" />
              <col />
              <col className="w-36" />
              <col className="w-44" />
            </colgroup>
            <thead>
              <tr className="sticky top-0 z-10 h-7 bg-background-section-burn">
                <th className="rounded-l-lg pr-2 pl-3 text-left system-xs-medium-uppercase text-text-tertiary">
                  {t(($) => $['deployTab.col.environment'])}
                </th>
                <th className="pr-2 pl-3 text-left system-xs-medium-uppercase text-text-tertiary">
                  {t(($) => $['studio.liveVersion'])}
                </th>
                <th className="pr-2 pl-3 text-left system-xs-medium-uppercase text-text-tertiary">
                  {t(($) => $['deployTab.col.status'])}
                </th>
                <th className="pr-2 pl-3 text-left system-xs-medium-uppercase text-text-tertiary">
                  {t(($) => $['studio.lastActivity'])}
                </th>
                <th className="pr-2 pl-3 text-left system-xs-medium-uppercase text-text-tertiary">
                  {t(($) => $['studio.accessPoints'])}
                </th>
                <th className="rounded-r-lg pr-2 pl-3 text-left system-xs-medium-uppercase text-text-tertiary">
                  {t(($) => $['deployTab.col.actions'])}
                </th>
              </tr>
            </thead>
            <tbody>
              {deployments.map((row) => (
                <EnvironmentRow
                  key={row.environment.id}
                  appId={appId}
                  row={row}
                  onChangeVersion={onChangeVersion}
                  onDeployLatest={onDeployLatest}
                  onRedeploy={onRedeploy}
                  onUndeploy={onUndeploy}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}
