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
    <div className="overflow-hidden rounded-lg border border-divider-subtle bg-components-panel-bg">
      {ACCESS_PERMISSIONS_SKELETON_KEYS.map(key => (
        <SkeletonRow
          key={key}
          className="grid gap-3 border-t border-divider-subtle px-4 py-3 first:border-t-0 lg:grid-cols-[minmax(140px,180px)_minmax(190px,230px)_minmax(0,1fr)] lg:items-center"
        >
          <SkeletonRectangle className="h-4 w-32 animate-pulse" />
          <SkeletonRectangle className="my-0 h-8 w-full animate-pulse rounded-lg" />
          <SkeletonRectangle className="my-0 h-8 w-full animate-pulse rounded-lg" />
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
                <div className="overflow-hidden rounded-lg border border-divider-subtle bg-components-panel-bg">
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
