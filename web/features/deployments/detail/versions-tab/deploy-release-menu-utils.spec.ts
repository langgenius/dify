import type {
  Environment,
  EnvironmentDeployment,
  Release,
} from '@dify/contracts/enterprise/types.gen'
import type { TFunction } from 'i18next'
import { ReleaseSource, RuntimeInstanceStatus } from '@dify/contracts/enterprise/types.gen'
import { describe, expect, it } from 'vitest'
import { buildDeployMenuSections } from './deploy-release-menu-utils'

const t = ((key: string, options?: { name?: string }) => {
  return options?.name ? `${key}:${options.name}` : key
}) as unknown as TFunction<'deployments'>

function createRelease(id: string): Release {
  return {
    id,
    appInstanceId: 'app-instance-1',
    displayName: id,
    description: '',
    source: ReleaseSource.RELEASE_SOURCE_SOURCE_APP,
    gateCommitId: id,
    requiredSlots: [],
    createdBy: {
      id: 'account-1',
      displayName: 'Dify Admin',
    },
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('buildDeployMenuSections', () => {
  it('disables deploy actions while an environment is undeploying', () => {
    const env = {
      id: 'env-1',
      displayName: 'Production',
    } as Environment
    const targetRelease = createRelease('release-1')
    const deployment = {
      appInstanceId: 'app-instance-1',
      environment: env,
      status: RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_UNDEPLOYING,
      currentRelease: createRelease('release-0'),
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as EnvironmentDeployment

    const sections = buildDeployMenuSections({
      environments: [env],
      environmentDeployments: [deployment],
      releaseRows: [targetRelease],
      releaseId: targetRelease.id,
      targetRelease,
      t,
    })

    expect(sections).toHaveLength(1)
    expect(sections[0]?.group).toBe('unavailable')
    expect(sections[0]?.rows[0]).toMatchObject({
      environmentId: env.id,
      state: 'deploying',
      label: 'versions.deployingTo:Production',
      disabledReason: 'versions.disabledReason.deploying',
    })
  })
})
