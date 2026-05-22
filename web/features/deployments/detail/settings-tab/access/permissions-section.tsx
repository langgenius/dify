'use client'

import type { Environment } from '@dify/contracts/enterprise/types.gen'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import { consoleQuery } from '@/service/client'
import { Section, SectionState } from '../../common'
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
    <DetailTable>
      <DetailTableHeader className="hidden pc:table-header-group">
        <DetailTableRow>
          <DetailTableHead className={ACCESS_PERMISSION_DETAIL_TABLE_COLUMN_CLASS_NAMES.environment}>{t('access.permissions.col.environment')}</DetailTableHead>
          <DetailTableHead className={ACCESS_PERMISSION_DETAIL_TABLE_COLUMN_CLASS_NAMES.permission}>{t('access.permissions.col.permission')}</DetailTableHead>
          <DetailTableHead className={ACCESS_PERMISSION_DETAIL_TABLE_COLUMN_CLASS_NAMES.subjects}>{t('access.permissions.col.subjects')}</DetailTableHead>
        </DetailTableRow>
      </DetailTableHeader>
      <DetailTableBody>
        {ACCESS_PERMISSIONS_SKELETON_KEYS.map(key => (
          <DetailTableRow key={key} className="block pc:table-row">
            <DetailTableCell className="block h-auto px-4 pt-3 pb-1 pc:table-cell pc:px-2.5 pc:py-[5px] pc:pl-3">
              <SkeletonRectangle className="h-4 w-32 animate-pulse" />
            </DetailTableCell>
            <DetailTableCell className="block h-auto px-4 py-1 pc:table-cell pc:px-2.5 pc:py-[5px] pc:pl-3">
              <SkeletonRectangle className="my-0 h-8 w-full animate-pulse rounded-lg" />
            </DetailTableCell>
            <DetailTableCell className="block h-auto px-4 pt-1 pb-3 pc:table-cell pc:px-2.5 pc:py-[5px] pc:pl-3">
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
  const environments = environmentDeploymentsQuery.data?.data
    ?.map(row => row.environment)
    .filter(hasEnvironment) ?? []

  return (
    <Section
      title={t('access.permissions.title')}
      description={t('access.permissions.description')}
      showDivider={false}
    >
      {environmentDeploymentsQuery.isLoading
        ? <AccessPermissionsSkeleton />
        : environmentDeploymentsQuery.isError
          ? <SectionState>{t('common.loadFailed')}</SectionState>
          : environments.length === 0
            ? (
                <SectionState>
                  {t('access.runAccess.noEnvs')}
                </SectionState>
              )
            : (
                <DetailTable>
                  <DetailTableHeader className="hidden pc:table-header-group">
                    <DetailTableRow>
                      <DetailTableHead className={ACCESS_PERMISSION_DETAIL_TABLE_COLUMN_CLASS_NAMES.environment}>{t('access.permissions.col.environment')}</DetailTableHead>
                      <DetailTableHead className={ACCESS_PERMISSION_DETAIL_TABLE_COLUMN_CLASS_NAMES.permission}>{t('access.permissions.col.permission')}</DetailTableHead>
                      <DetailTableHead className={ACCESS_PERMISSION_DETAIL_TABLE_COLUMN_CLASS_NAMES.subjects}>{t('access.permissions.col.subjects')}</DetailTableHead>
                    </DetailTableRow>
                  </DetailTableHeader>
                  <DetailTableBody>
                    {environments.map(environment => (
                      <EnvironmentPermissionRow
                        key={environment.id}
                        appInstanceId={appInstanceId}
                        environment={environment}
                      />
                    ))}
                  </DetailTableBody>
                </DetailTable>
              )}
    </Section>
  )
}
