'use client'

import type {
  AppEnvironment,
  EnvironmentDeployment,
} from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { DeploymentVersion } from '../version'
import type { UndeployHandler } from './types'
import { Button } from '@langgenius/dify-ui/button'
import {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaCorner,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@langgenius/dify-ui/scroll-area'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import {
  appEnvironmentDeploymentsAtom,
  appEnvironmentDeploymentsIsErrorAtom,
  appEnvironmentDeploymentsIsLoadingAtom,
  appEnvironmentDeploymentsIsRetryingAtom,
  appEnvironmentDeploymentsRefetchAtom,
  appEnvironmentUsageAtom,
  latestAppWorkflowVersionAtom,
  latestAppWorkflowVersionIsErrorAtom,
  latestAppWorkflowVersionIsRetryingAtom,
  latestAppWorkflowVersionRefetchAtom,
} from '../state'
import { EnvironmentDeployMenu } from './deploy-menu'
import { EnvironmentTableEmpty } from './empty-state'
import { EnvironmentRow } from './row'

type EnvironmentTableProps = {
  appId: string
  onChangeVersion: (deployment: EnvironmentDeployment) => void
  onDeployLatest: (deployment: EnvironmentDeployment, version: DeploymentVersion) => void
  onDeployToEnvironment: (environment: AppEnvironment) => void
  onRedeploy: (deployment: EnvironmentDeployment) => void
  onUndeploy: UndeployHandler
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
  const { t: tCommon } = useTranslation('common')
  const deployments = useAtomValue(appEnvironmentDeploymentsAtom) ?? []
  const isLoading = useAtomValue(appEnvironmentDeploymentsIsLoadingAtom)
  const isError = useAtomValue(appEnvironmentDeploymentsIsErrorAtom)
  const isRetrying = useAtomValue(appEnvironmentDeploymentsIsRetryingAtom)
  const refetchDeployments = useAtomValue(appEnvironmentDeploymentsRefetchAtom)
  const usage = useAtomValue(appEnvironmentUsageAtom)
  const latestVersion = useAtomValue(latestAppWorkflowVersionAtom)
  const latestVersionIsError = useAtomValue(latestAppWorkflowVersionIsErrorAtom)
  const latestVersionIsRetrying = useAtomValue(latestAppWorkflowVersionIsRetryingAtom)
  const refetchLatestVersion = useAtomValue(latestAppWorkflowVersionRefetchAtom)
  const deployableLatestVersion = latestVersionIsError ? undefined : latestVersion
  const showLoadingState = isLoading && deployments.length === 0
  const showErrorState = isError && deployments.length === 0
  const showEmptyState = !isLoading && !isError && deployments.length === 0

  return (
    <section className="flex min-h-0 grow flex-col gap-3">
      <div className="flex shrink-0 items-center justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <h2
            id="deploy-environments-title"
            className="truncate system-md-semibold text-text-primary"
          >
            {t(($) => $['studio.environments'])}
          </h2>
          {usage && (
            <>
              <span aria-hidden className="system-xs-regular text-text-quaternary">
                ·
              </span>
              <span className="truncate system-xs-regular text-text-tertiary">
                {t(($) => $['studio.environmentsInUse'], usage)}
              </span>
            </>
          )}
        </div>
        <EnvironmentDeployMenu onSelectEnvironment={onDeployToEnvironment} />
      </div>

      {latestVersionIsError && (
        <div
          role="alert"
          className="flex shrink-0 items-center gap-2 rounded-xl border border-state-destructive-border bg-state-destructive-hover-alt p-3"
        >
          <span
            aria-hidden
            className="i-ri-error-warning-fill size-4 shrink-0 text-text-destructive"
          />
          <p className="grow system-sm-medium text-text-destructive">
            {t(($) => $['studio.latestVersionLoadFailed'])}
          </p>
          <Button
            size="small"
            variant="secondary"
            loading={latestVersionIsRetrying}
            disabled={latestVersionIsRetrying}
            onClick={() => void refetchLatestVersion()}
            className="gap-1 px-2"
          >
            <span aria-hidden className="i-ri-reset-left-line size-3" />
            <span>{tCommon(($) => $['operation.retry'])}</span>
          </Button>
        </div>
      )}

      <ScrollArea className="relative min-h-0 w-full grow overflow-hidden">
        <ScrollAreaViewport
          aria-labelledby="deploy-environments-title"
          aria-busy={showLoadingState || isRetrying || latestVersionIsRetrying}
          className="overscroll-contain"
          role="region"
        >
          <ScrollAreaContent className="min-h-full">
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
                      latestVersion={deployableLatestVersion}
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
          </ScrollAreaContent>
        </ScrollAreaViewport>
        <ScrollAreaScrollbar>
          <ScrollAreaThumb />
        </ScrollAreaScrollbar>
        <ScrollAreaScrollbar orientation="horizontal">
          <ScrollAreaThumb />
        </ScrollAreaScrollbar>
        <ScrollAreaCorner />
      </ScrollArea>
    </section>
  )
}
