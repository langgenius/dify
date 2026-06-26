'use client'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'
import { DeploymentEmptyState, DeploymentStateMessage } from '../../shared/components/empty-state'
import { hasRuntimeInstanceDeployment } from '../../shared/domain/runtime-status'
import {
  DetailTable,
  DetailTableBody,
  DetailTableCard,
  DetailTableCardList,
  DetailTableCell,
  DetailTableHead,
  DetailTableHeader,
  DetailTableRow,
} from '../components/detail-table'
import {
  DEPLOYMENT_DETAIL_TABLE_COLUMN_CLASS_NAMES,
} from '../components/detail-table-styles'
import { deploymentEnvironmentDeploymentsQueryAtom } from '../state'
import { DeploymentEnvironmentList } from './deployment-environment-list'
import { NewDeploymentButton } from './new-deployment-button'

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
                <DetailTableCell className={DEPLOYMENT_DETAIL_TABLE_COLUMN_CLASS_NAMES.actions}>
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

export function DeployTab() {
  const { t } = useTranslation('deployments')
  const environmentDeploymentsQuery = useAtomValue(deploymentEnvironmentDeploymentsQueryAtom)
  const environmentDeployments = environmentDeploymentsQuery.data
  const rows = environmentDeployments?.environmentDeployments.filter(hasRuntimeInstanceDeployment) ?? []
  const isLoading = environmentDeploymentsQuery.isLoading
  const hasError = environmentDeploymentsQuery.isError

  return (
    <div className="flex w-full min-w-0 flex-col gap-4 px-6 py-6">
      {isLoading
        ? <DeploymentEnvironmentListSkeleton />
        : hasError
          ? <DeploymentStateMessage variant="list">{t('common.loadFailed')}</DeploymentStateMessage>
          : rows.length === 0
            ? (
                <DeploymentEmptyState
                  icon="i-ri-server-line"
                  title={t('deployTab.emptyTitle')}
                  description={t('deployTab.emptyDescription')}
                  action={<NewDeploymentButton />}
                />
              )
            : (
                <DeploymentEnvironmentList rows={rows} />
              )}
    </div>
  )
}
