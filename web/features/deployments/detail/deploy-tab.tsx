'use client'
import { Button } from '@langgenius/dify-ui/button'
import { useQuery } from '@tanstack/react-query'
import { useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'
import { consoleQuery } from '@/service/client'
import { deploymentStatusPollingInterval } from '../runtime-status'
import { openDeployDrawerAtom } from '../store'
import {
  DetailListState,
} from './common'
import { DeploymentEnvironmentList } from './deploy-tab/deployment-environment-list'
import {
  DEPLOYMENT_DETAIL_LIST_GRID_CLASS_NAME,
  DETAIL_LIST_CLASS_NAME,
  DETAIL_LIST_DESKTOP_ROW_CLASS_NAME,
  DETAIL_LIST_HEADER_ROW_CLASS_NAME,
  DETAIL_LIST_ROW_CLASS_NAME,
} from './list-styles'

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
  const { t } = useTranslation('deployments')

  return (
    <>
      <div className={`${DETAIL_LIST_CLASS_NAME} pc:hidden`}>
        {DEPLOYMENT_TABLE_ROW_SKELETON_KEYS.map(key => (
          <div key={key} className={DETAIL_LIST_ROW_CLASS_NAME}>
            <div className="flex flex-col gap-3 p-4">
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
              <SkeletonRectangle className="my-0 size-8 animate-pulse rounded-md" />
            </div>
          </div>
        ))}
      </div>
      <div className="hidden pc:block">
        <div className={DETAIL_LIST_CLASS_NAME}>
          <div className={`${DETAIL_LIST_HEADER_ROW_CLASS_NAME} ${DEPLOYMENT_DETAIL_LIST_GRID_CLASS_NAME}`}>
            <div>{t('deployTab.col.environment')}</div>
            <div>{t('deployTab.col.status')}</div>
            <div>{t('deployTab.col.currentRelease')}</div>
            <div className="text-right">{t('deployTab.col.actions')}</div>
          </div>
          {DEPLOYMENT_TABLE_ROW_SKELETON_KEYS.map(key => (
            <div key={key} className={DETAIL_LIST_ROW_CLASS_NAME}>
              <div className={`${DETAIL_LIST_DESKTOP_ROW_CLASS_NAME} ${DEPLOYMENT_DETAIL_LIST_GRID_CLASS_NAME}`}>
                <div className="min-w-0">
                  <SkeletonRectangle className="h-3 w-32 animate-pulse" />
                </div>
                <div className="min-w-0">
                  <SkeletonRectangle className="my-0 h-4 w-18 animate-pulse rounded-md" />
                </div>
                <div className="min-w-0">
                  <SkeletonRow className="gap-2">
                    <SkeletonRectangle className="h-3 w-16 animate-pulse" />
                    <SkeletonRectangle className="h-2.5 w-18 animate-pulse" />
                  </SkeletonRow>
                </div>
                <div className="flex justify-end">
                  <SkeletonRectangle className="my-0 size-8 animate-pulse rounded-md" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
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
    <div className="mx-auto flex w-full max-w-[1080px] min-w-0 flex-col gap-4 px-6 py-6">
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
          ? <DetailListState>{t('common.loadFailed')}</DetailListState>
          : rows.length === 0
            ? <DetailListState>{t('deployTab.empty')}</DetailListState>
            : (
                <DeploymentEnvironmentList appInstanceId={appInstanceId} rows={rows} />
              )}
    </div>
  )
}
