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
  DetailTable,
  DetailTableBody,
  DetailTableCard,
  DetailTableCardList,
  DetailTableCell,
  DetailTableHead,
  DetailTableHeader,
  DetailTableRow,
} from './table'
import {
  DEPLOYMENT_DETAIL_TABLE_COLUMN_CLASS_NAMES,
} from './table-styles'

export function NewDeploymentButton({ appInstanceId }: {
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
      <DetailTableCardList className="pc:hidden">
        {DEPLOYMENT_TABLE_ROW_SKELETON_KEYS.map(key => (
          <DetailTableCard key={key}>
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
          </DetailTableCard>
        ))}
      </DetailTableCardList>
      <div className="hidden pc:block">
        <DetailTable>
          <DetailTableHeader>
            <DetailTableRow>
              <DetailTableHead className={DEPLOYMENT_DETAIL_TABLE_COLUMN_CLASS_NAMES.environment}>{t('deployTab.col.environment')}</DetailTableHead>
              <DetailTableHead className={DEPLOYMENT_DETAIL_TABLE_COLUMN_CLASS_NAMES.status}>{t('deployTab.col.status')}</DetailTableHead>
              <DetailTableHead className={DEPLOYMENT_DETAIL_TABLE_COLUMN_CLASS_NAMES.currentRelease}>{t('deployTab.col.currentRelease')}</DetailTableHead>
              <DetailTableHead className={`${DEPLOYMENT_DETAIL_TABLE_COLUMN_CLASS_NAMES.actions} text-right`}>{t('deployTab.col.actions')}</DetailTableHead>
            </DetailTableRow>
          </DetailTableHeader>
          <DetailTableBody>
            {DEPLOYMENT_TABLE_ROW_SKELETON_KEYS.map(key => (
              <DetailTableRow key={key}>
                <DetailTableCell>
                  <SkeletonRectangle className="h-3 w-32 animate-pulse" />
                </DetailTableCell>
                <DetailTableCell>
                  <SkeletonRectangle className="my-0 h-4 w-18 animate-pulse rounded-md" />
                </DetailTableCell>
                <DetailTableCell>
                  <SkeletonRow className="gap-2">
                    <SkeletonRectangle className="h-3 w-16 animate-pulse" />
                    <SkeletonRectangle className="h-2.5 w-18 animate-pulse" />
                  </SkeletonRow>
                </DetailTableCell>
                <DetailTableCell>
                  <div className="flex justify-end">
                    <SkeletonRectangle className="my-0 size-8 animate-pulse rounded-md" />
                  </div>
                </DetailTableCell>
              </DetailTableRow>
            ))}
          </DetailTableBody>
        </DetailTable>
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
    <div className="flex w-full min-w-0 flex-col gap-4 px-6 py-6">
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
