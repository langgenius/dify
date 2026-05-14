'use client'

import type {
  EnvironmentAccessRow,
} from '@dify/contracts/enterprise/types.gen'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'
import { consoleQuery } from '@/service/client'
import { Section, SectionState } from '../../common'
import { EnvironmentPermissionRow } from './permissions'

const ACCESS_PERMISSIONS_SKELETON_KEYS = ['production', 'staging', 'development']

function hasEnvironment(row: EnvironmentAccessRow): row is EnvironmentAccessRow & {
  environment: NonNullable<EnvironmentAccessRow['environment']>
} {
  return Boolean(row.environment?.id)
}

function AccessPermissionsSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {ACCESS_PERMISSIONS_SKELETON_KEYS.map(key => (
        <SkeletonRow key={key} className="flex-wrap items-center gap-x-3 gap-y-1.5">
          <SkeletonRectangle className="h-3 w-35 animate-pulse" />
          <SkeletonRectangle className="my-0 h-8 w-55 animate-pulse rounded-lg" />
        </SkeletonRow>
      ))}
    </div>
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
      layout="row"
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
                <div className="flex flex-col gap-3">
                  {permissionRows.map(row => (
                    <EnvironmentPermissionRow
                      key={row.environment.id}
                      appInstanceId={appInstanceId}
                      environment={row.environment}
                      summaryPolicy={row}
                    />
                  ))}
                </div>
              )}
    </Section>
  )
}
