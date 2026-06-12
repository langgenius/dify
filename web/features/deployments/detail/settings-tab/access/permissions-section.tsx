'use client'

import type { AccessChannels, EnvironmentAccessPolicy } from '@dify/contracts/enterprise/types.gen'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import { DeploymentEmptyState, DeploymentStateMessage } from '../../../components/empty-state'
import { Section } from '../../common'
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
  accessChannels,
  environmentPolicies,
  isLoading,
  isError,
}: {
  appInstanceId: string
  accessChannels?: AccessChannels
  environmentPolicies?: EnvironmentAccessPolicy[]
  isLoading: boolean
  isError: boolean
}) {
  const { t } = useTranslation('deployments')
  const policyRows = environmentPolicies ?? []
  const permissionsDisabled = !(accessChannels?.webAppEnabled ?? false)

  return (
    <Section
      title={t('access.permissions.title')}
      description={t('access.permissions.description')}
      showDivider={false}
    >
      {isLoading
        ? <AccessPermissionsSkeleton />
        : isError
          ? <DeploymentStateMessage variant="section">{t('common.loadFailed')}</DeploymentStateMessage>
          : policyRows.length === 0
            ? (
                <DeploymentEmptyState
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
                    {policyRows.map((environmentPolicy) => {
                      const environment = environmentPolicy.environment
                      return (
                        <EnvironmentPermissionRow
                          key={environment.id}
                          appInstanceId={appInstanceId}
                          disabled={permissionsDisabled}
                          environment={environment}
                          summaryPolicy={environmentPolicy.policy}
                          resolvedSubjects={environmentPolicy.resolvedSubjects}
                        />
                      )
                    })}
                  </DetailTableBody>
                </DetailTable>
              )}
    </Section>
  )
}
