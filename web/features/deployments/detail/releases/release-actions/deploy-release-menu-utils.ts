import type {
  Environment,
  EnvironmentDeployment,
  Release,
} from '@dify/contracts/enterprise/types.gen'
import type { TFunction } from 'i18next'
import { releaseDeploymentAction } from '../../../shared/domain/release-action'
import { isRuntimeDeploymentInProgress, isUndeployedDeploymentRow } from '../../../shared/domain/runtime-status'

export type DeployMenuRowState = 'deploy' | 'rollback' | 'current' | 'deploying'

export type DeployMenuRow = {
  env?: Environment
  environmentId: string
  state: DeployMenuRowState
  label: string
  disabledReason?: string
}

export type DeployMenuGroup = 'deploy' | 'rollback' | 'unavailable'

export type DeployMenuSection = {
  group: DeployMenuGroup
  rows: DeployMenuRow[]
}

const GROUP_ORDER: DeployMenuGroup[] = ['deploy', 'rollback', 'unavailable']

function stateToGroup(state: DeployMenuRowState): DeployMenuGroup {
  if (state === 'rollback')
    return 'rollback'
  if (state === 'deploy')
    return 'deploy'
  return 'unavailable'
}

export function releaseUsageCount(releaseId: string, deploymentRows: EnvironmentDeployment[]) {
  const environmentIds = new Set<string>()

  deploymentRows.forEach((row) => {
    const usesRelease = row.currentRelease?.id === releaseId || row.desiredRelease?.id === releaseId
    if (usesRelease)
      environmentIds.add(row.environment.id)
  })

  return environmentIds.size
}

function buildDeployMenuRow({
  env,
  deploymentRows,
  releaseRows,
  releaseId,
  targetRelease,
  t,
}: {
  env: Environment
  deploymentRows: EnvironmentDeployment[]
  releaseRows: Release[]
  releaseId: string
  targetRelease: Release
  t: TFunction<'deployments'>
}): DeployMenuRow {
  const envId = env.id
  const envName = env.displayName
  const row = deploymentRows.find(item => item.environment.id === envId)
  const currentRelease = row?.currentRelease
  const isCurrent = currentRelease?.id === releaseId
  const isEnvironmentInProgress = isRuntimeDeploymentInProgress(row?.status)

  if (isEnvironmentInProgress) {
    return {
      env,
      environmentId: envId,
      state: 'deploying',
      label: t('versions.deployingTo', { name: envName }),
      disabledReason: t('versions.disabledReason.deploying'),
    }
  }
  if (isCurrent) {
    return {
      env,
      environmentId: envId,
      state: 'current',
      label: t('versions.currentOn', { name: envName }),
      disabledReason: t('versions.disabledReason.current', { name: envName }),
    }
  }

  const action = releaseDeploymentAction({
    targetRelease,
    currentRelease,
    releaseRows,
    isExistingRelease: true,
  })

  if (!row) {
    return {
      env,
      environmentId: envId,
      state: 'deploy',
      label: t('versions.deployTo', { name: envName }),
    }
  }
  if (action === 'rollback') {
    return {
      env,
      environmentId: envId,
      state: 'rollback',
      label: t('versions.rollbackTo', { name: envName }),
    }
  }
  return {
    env,
    environmentId: envId,
    state: 'deploy',
    label: t('versions.deployTo', { name: envName }),
  }
}

export function buildDeployMenuSections({
  environments,
  environmentDeployments,
  releaseRows,
  releaseId,
  targetRelease,
  t,
}: {
  environments: Environment[]
  environmentDeployments: EnvironmentDeployment[]
  releaseRows: Release[]
  releaseId: string
  targetRelease: Release
  t: TFunction<'deployments'>
}) {
  const deploymentRows = environmentDeployments.filter(row => !isUndeployedDeploymentRow(row))
  const menuRows = environments.map(env => buildDeployMenuRow({
    env,
    deploymentRows,
    releaseRows,
    releaseId,
    targetRelease,
    t,
  }))

  return GROUP_ORDER.map(group => ({
    group,
    rows: menuRows.filter(row => stateToGroup(row.state) === group),
  })).filter((section): section is DeployMenuSection => section.rows.length > 0)
}
