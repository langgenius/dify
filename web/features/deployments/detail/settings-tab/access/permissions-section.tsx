'use client'

import type {
  EnvironmentAccessRow,
} from '@dify/contracts/enterprise/types.gen'
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

function hasEnvironment(row: EnvironmentAccessRow): row is EnvironmentAccessRow & {
  environment: NonNullable<EnvironmentAccessRow['environment']>
} {
  return Boolean(row.environment?.id)
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
            <DetailTableCell className="block h-auto px-4 pt-3 pb-1 pc:table-cell pc:h-12 pc:py-3">
              <SkeletonRectangle className="h-4 w-32 animate-pulse" />
            </DetailTableCell>
            <DetailTableCell className="block h-auto px-4 py-1 pc:table-cell pc:h-12 pc:py-3">
              <SkeletonRectangle className="my-0 h-8 w-full animate-pulse rounded-lg" />
            </DetailTableCell>
            <DetailTableCell className="block h-auto px-4 pt-1 pb-3 pc:table-cell pc:h-12 pc:py-3">
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
  const accessConfigQuery = useQuery(consoleQuery.enterprise.appDeployAccessService.getAppInstanceAccess.queryOptions({
    input: {
      params: { appInstanceId },
    },
  }))
  const accessConfig = accessConfigQuery.data
  const permissionRows = accessConfig?.permissions?.filter(hasEnvironment) ?? []

  return (
    <Section
      title={t('access.permissions.title')}
      description={t('access.permissions.description')}
      showDivider={false}
    >
      {accessConfigQuery.isLoading
        ? <AccessPermissionsSkeleton />
        : accessConfigQuery.isError
          ? <SectionState>{t('common.loadFailed')}</SectionState>
          : permissionRows.length === 0
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
                    {permissionRows.map(row => (
                      <EnvironmentPermissionRow
                        key={row.environment.id}
                        appInstanceId={appInstanceId}
                        environment={row.environment}
                        summaryPolicy={row}
                      />
                    ))}
                  </DetailTableBody>
                </DetailTable>
              )}
    </Section>
  )
}
