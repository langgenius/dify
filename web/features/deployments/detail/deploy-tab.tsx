'use client'
import { Button } from '@langgenius/dify-ui/button'
import { useQuery } from '@tanstack/react-query'
import { useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'
import { consoleQuery } from '@/service/client'
import { deploymentStatusPollingInterval } from '../runtime-status'
import { openDeployDrawerAtom } from '../store'
import { SectionState } from './common'
import { DeploymentEnvironmentList } from './deploy-tab/deployment-environment-list'

function NewDeploymentButton({ appInstanceId }: {
  appInstanceId: string
}) {
  const { t } = useTranslation('deployments')
  const openDeployDrawer = useSetAtom(openDeployDrawerAtom)

  return (
    <Button
      size="medium"
      variant="primary"
      className="gap-1.5"
      onClick={() => openDeployDrawer({ appInstanceId })}
    >
      {t('deployTab.newDeployment')}
    </Button>
  )
}

const DEPLOYMENT_TABLE_ROW_SKELETON_KEYS = ['production', 'staging']

function DeploymentEnvironmentListSkeleton() {
  return (
    <div className="overflow-hidden border-y border-divider-subtle">
      {DEPLOYMENT_TABLE_ROW_SKELETON_KEYS.map(key => (
        <div key={key} className="border-b border-divider-subtle last:border-b-0">
          <div className="flex w-full flex-col gap-3 py-3 lg:grid lg:grid-cols-[minmax(180px,0.9fr)_minmax(220px,1fr)_max-content] lg:items-center lg:gap-6">
            <div className="flex min-w-0 flex-col gap-1.5">
              <SkeletonRectangle className="h-3 w-32 animate-pulse" />
              <SkeletonRectangle className="my-0 h-4 w-18 animate-pulse rounded-md" />
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <SkeletonRectangle className="h-2.5 w-24 animate-pulse" />
              <SkeletonRow className="gap-2">
                <SkeletonRectangle className="h-3 w-16 animate-pulse" />
                <SkeletonRectangle className="h-2.5 w-18 animate-pulse" />
              </SkeletonRow>
            </div>
            <div className="flex justify-start lg:justify-end">
              <SkeletonRectangle className="my-0 h-7 w-32 animate-pulse rounded-lg" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export function DeployTab({ appInstanceId }: {
  appInstanceId: string
}) {
  const { t } = useTranslation('deployments')
  const environmentDeploymentsQuery = useQuery(consoleQuery.enterprise.appDeploymentService.listEnvironmentDeployments.queryOptions({
    input: {
      params: { appInstanceId },
    },
    refetchInterval: query => deploymentStatusPollingInterval(query.state.data),
  }))
  const environmentDeployments = environmentDeploymentsQuery.data
  const rows = environmentDeployments?.data?.filter(row => row.environment?.id) ?? []
  const isLoading = environmentDeploymentsQuery.isLoading
  const hasError = environmentDeploymentsQuery.isError

  return (
    <div className="mx-auto flex w-full max-w-[1280px] min-w-0 flex-col gap-4 px-6 py-6 2xl:max-w-[1440px]">
      <div className="flex items-center justify-between">
        <div className="system-sm-semibold text-text-primary">
          {t('deployTab.envCount')}
          {' '}
          <span className="system-sm-regular text-text-tertiary">
            (
            {rows.length}
            )
          </span>
        </div>
        <NewDeploymentButton appInstanceId={appInstanceId} />
      </div>

      {isLoading
        ? <DeploymentEnvironmentListSkeleton />
        : hasError
          ? <SectionState>{t('common.loadFailed')}</SectionState>
          : rows.length === 0
            ? (
                <div className="flex min-h-36 items-center justify-center border-y border-dashed border-divider-subtle px-4 py-12 text-center system-sm-regular text-text-tertiary">
                  {t('deployTab.empty')}
                </div>
              )
            : (
                <DeploymentEnvironmentList appInstanceId={appInstanceId} rows={rows} />
              )}
    </div>
  )
}
