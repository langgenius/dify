'use client'

import type { Environment } from '@dify/contracts/enterprise/types.gen'
import { cn } from '@langgenius/dify-ui/cn'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import { consoleQuery } from '@/service/client'
import { DetailEmptyState, Section, SectionState } from '../../common'
import {
  DetailTable,
  DetailTableBody,
  DetailTableCell,
  DetailTableHead,
  DetailTableHeader,
  DetailTableRow,
} from '../../table'
import {
  ACCESS_PERMISSION_DETAIL_TABLE_COLUMN_CLASS_NAMES,
} from '../../table-styles'
import { EnvironmentPermissionRow } from './permissions'

const ACCESS_PERMISSIONS_SKELETON_KEYS = ['production', 'staging', 'development']

function hasEnvironment(environment?: Environment): environment is Environment & { id: string } {
  return Boolean(environment?.id)
}

function AccessPermissionsSkeleton() {
  const { t } = useTranslation('deployments')

  return (
    <DetailTable className="block pc:table">
      <DetailTableHeader className="hidden pc:table-header-group">
        <DetailTableRow>
          <DetailTableHead className={ACCESS_PERMISSION_DETAIL_TABLE_COLUMN_CLASS_NAMES.environment}>{t('access.permissions.col.environment')}</DetailTableHead>
          <DetailTableHead className={ACCESS_PERMISSION_DETAIL_TABLE_COLUMN_CLASS_NAMES.permission}>{t('access.permissions.col.permission')}</DetailTableHead>
          <DetailTableHead className={ACCESS_PERMISSION_DETAIL_TABLE_COLUMN_CLASS_NAMES.subjects}>{t('access.permissions.col.subjects')}</DetailTableHead>
        </DetailTableRow>
      </DetailTableHeader>
      <DetailTableBody className="block pc:table-row-group">
        {ACCESS_PERMISSIONS_SKELETON_KEYS.map(key => (
          <DetailTableRow key={key} className="block h-auto pc:table-row">
            <DetailTableCell className="block h-auto max-w-none px-4 pt-3 pb-1 pc:table-cell pc:p-3 pc:pr-2">
              <SkeletonRectangle className="h-4 w-32 animate-pulse" />
            </DetailTableCell>
            <DetailTableCell className="block h-auto max-w-none px-4 py-1 pc:table-cell pc:p-3 pc:pr-2">
              <SkeletonRectangle className="my-0 h-8 w-full animate-pulse rounded-lg" />
            </DetailTableCell>
            <DetailTableCell className="block h-auto max-w-none px-4 pt-1 pb-3 pc:table-cell pc:p-3 pc:pr-2">
              <SkeletonRectangle className="my-0 h-8 w-full animate-pulse rounded-lg" />
            </DetailTableCell>
          </DetailTableRow>
        ))}
      </DetailTableBody>
    </DetailTable>
  )
}

export function AccessPermissionsSection({
  appInstanceId,
}: {
  appInstanceId: string
}) {
  const { t } = useTranslation('deployments')
  const environmentDeploymentsQuery = useQuery(consoleQuery.enterprise.deploymentService.listEnvironmentDeployments.queryOptions({
    input: {
      params: { appInstanceId },
    },
  }))
  const accessChannelsQuery = useQuery(consoleQuery.enterprise.accessService.getAccessChannels.queryOptions({
    input: {
      params: { appInstanceId },
    },
  }))
  const environments = environmentDeploymentsQuery.data?.data
    ?.map(row => row.environment)
    .filter(hasEnvironment) ?? []
  const permissionsDisabled = !(accessChannelsQuery.data?.accessChannels?.webAppEnabled ?? false)
  const isLoading = environmentDeploymentsQuery.isLoading || accessChannelsQuery.isLoading
  const isError = environmentDeploymentsQuery.isError || accessChannelsQuery.isError

  return (
    <Section
      title={t('access.permissions.title')}
      description={t('access.permissions.description')}
      showDivider={false}
    >
      {isLoading
        ? <AccessPermissionsSkeleton />
        : isError
          ? <SectionState>{t('common.loadFailed')}</SectionState>
          : environments.length === 0
            ? (
                <DetailEmptyState
                  variant="section"
                  icon="i-ri-rocket-line"
                  title={t('access.runAccess.noEnvsTitle')}
                  description={t('access.runAccess.noEnvs')}
                />
              )
            : (
                <DetailTable className={cn('block pc:table', permissionsDisabled && 'opacity-60')}>
                  <DetailTableHeader className="hidden pc:table-header-group">
                    <DetailTableRow>
                      <DetailTableHead className={ACCESS_PERMISSION_DETAIL_TABLE_COLUMN_CLASS_NAMES.environment}>{t('access.permissions.col.environment')}</DetailTableHead>
                      <DetailTableHead className={ACCESS_PERMISSION_DETAIL_TABLE_COLUMN_CLASS_NAMES.permission}>{t('access.permissions.col.permission')}</DetailTableHead>
                      <DetailTableHead className={ACCESS_PERMISSION_DETAIL_TABLE_COLUMN_CLASS_NAMES.subjects}>{t('access.permissions.col.subjects')}</DetailTableHead>
                    </DetailTableRow>
                  </DetailTableHeader>
                  <DetailTableBody className="block pc:table-row-group">
                    {environments.map(environment => (
                      <EnvironmentPermissionRow
                        key={environment.id}
                        appInstanceId={appInstanceId}
                        disabled={permissionsDisabled}
                        environment={environment}
                      />
                    ))}
                  </DetailTableBody>
                </DetailTable>
              )}
    </Section>
  )
}
