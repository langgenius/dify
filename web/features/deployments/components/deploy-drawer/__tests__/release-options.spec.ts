import type { EnvironmentDeployment, Release } from '@dify/contracts/enterprise/types.gen'
import { describe, expect, it } from 'vitest'
import {
  currentReleaseIdForEnvironment,
  selectableDeployReleases,
} from '../release-options'

function createRelease(id: string): Release {
  return { id, name: id }
}

function createDeploymentRow(environmentId: string, releaseId?: string): EnvironmentDeployment {
  return {
    environment: {
      id: environmentId,
      name: environmentId,
    },
    currentRelease: releaseId ? createRelease(releaseId) : undefined,
  }
}

describe('deploy drawer release options', () => {
  // Scenario: the locked environment determines which release is already running.
  it('should find the current release for a locked environment', () => {
    const rows = [
      createDeploymentRow('env-production', 'release-current'),
      createDeploymentRow('env-staging', 'release-staging'),
    ]

    expect(currentReleaseIdForEnvironment(rows, 'env-production')).toBe('release-current')
    expect(currentReleaseIdForEnvironment(rows, 'env-missing')).toBeUndefined()
  })

  // Scenario: Deploy Another Release should not offer the release already deployed to that environment.
  it('should exclude the current release when deploying another release to a locked environment', () => {
    const releases = [
      createRelease('release-current'),
      createRelease('release-next'),
      createRelease('release-older'),
    ]

    const options = selectableDeployReleases({
      releases,
      lockedEnvId: 'env-production',
      currentReleaseId: 'release-current',
    })

    expect(options.map(release => release.id)).toEqual(['release-next', 'release-older'])
  })

  // Scenario: explicit redeploy flows keep the preset release visible because the drawer is read-only for release choice.
  it('should keep all releases when a preset release is provided', () => {
    const releases = [
      createRelease('release-current'),
      createRelease('release-next'),
    ]

    const options = selectableDeployReleases({
      releases,
      lockedEnvId: 'env-production',
      currentReleaseId: 'release-current',
      presetReleaseId: 'release-current',
    })

    expect(options.map(release => release.id)).toEqual(['release-current', 'release-next'])
  })
})
