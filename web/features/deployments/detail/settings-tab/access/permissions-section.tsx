'use client'

import type { EnvironmentAccessPolicy } from '@dify/contracts/enterprise/types.gen'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import { DeploymentEmptyState, DeploymentStateMessage } from '../../../components/empty-state'
import { deploymentRouteAppInstanceIdAtom } from '../../../route-state'
import { Section } from '../../common'
import { EnvironmentPermissionRow } from './permissions'
import { accessSettingsQueryAtom } from './state'

const ACCESS_PERMISSIONS_SKELETON_KEYS = ['production', 'staging', 'development']

function AccessPermissionsSkeleton() {
  return (
    <div className="flex min-w-0 flex-col">
      {ACCESS_PERMISSIONS_SKELETON_KEYS.map(key => (
        <div key={key} className="flex min-w-0 flex-col gap-2 border-b border-divider-subtle py-4 first:pt-0 last:border-b-0 last:pb-0">
          <SkeletonRectangle className="h-4 w-32 animate-pulse" />
          <SkeletonRectangle className="my-0 h-8 w-full animate-pulse rounded-lg" />
        </div>
      ))}
    </div>
  )
}

export function AccessPermissionsSection() {
  const { t } = useTranslation('deployments')
  const appInstanceId = useAtomValue(deploymentRouteAppInstanceIdAtom)
  const accessSettingsQuery = useAtomValue(accessSettingsQueryAtom)
  const environmentPolicies: EnvironmentAccessPolicy[] | undefined = accessSettingsQuery.data?.environmentPolicies
  const isLoading = accessSettingsQuery.isLoading
  const isError = accessSettingsQuery.isError
  const policyRows = environmentPolicies ?? []

  return (
    <Section
      title={t('access.permissions.title')}
      showDivider={false}
    >
      {isLoading
        ? <AccessPermissionsSkeleton />
        : isError || !appInstanceId
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
                <div className="flex min-w-0 flex-col">
                  {policyRows.map((environmentPolicy) => {
                    const environment = environmentPolicy.environment
                    return (
                      <EnvironmentPermissionRow
                        key={environment.id}
                        environment={environment}
                        summaryPolicy={environmentPolicy.policy}
                        resolvedSubjects={environmentPolicy.resolvedSubjects}
                      />
                    )
                  })}
                </div>
              )}
    </Section>
  )
}
