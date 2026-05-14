import type { EnvironmentDeployment, ReleaseRow } from '@dify/contracts/enterprise/types.gen'
import { describe, expect, it } from 'vitest'
import { computeDrift, computeOverviewStats, latestReleaseId } from '../overview-drift'

function row(overrides: EnvironmentDeployment): EnvironmentDeployment {
  return overrides
}

function release(overrides: ReleaseRow): ReleaseRow {
  return overrides
}

describe('computeDrift', () => {
  it('should return undeployed when the runtime row signals undeployed', () => {
    // Arrange
    const runtime = row({
      environment: { id: 'env-1', name: 'prod' },
      status: 'undeployed',
    })

    // Act
    const result = computeDrift(runtime, [])

    // Assert
    expect(result).toEqual({ kind: 'undeployed' })
  })

  it('should return undeployed when there is no id, current release, or detail', () => {
    // Arrange
    const runtime = row({
      environment: { id: 'env-1', name: 'prod' },
    })

    // Act
    const result = computeDrift(runtime, [release({ id: 'r-1' })])

    // Assert
    expect(result).toEqual({ kind: 'undeployed' })
  })

  it('should return unknown when the deployed release has no id', () => {
    // Arrange
    const runtime = row({
      environment: { id: 'env-1' },
      status: 'ready',
      runtime: { runtimeInstanceId: 'rt-1', replicas: 1 },
    })

    // Act
    const result = computeDrift(runtime, [release({ id: 'r-1' })])

    // Assert
    expect(result).toEqual({ kind: 'unknown' })
  })

  it('should return unknown when the deployed release is not in the loaded window', () => {
    // Arrange
    const runtime = row({
      environment: { id: 'env-1' },
      status: 'ready',
      runtime: { runtimeInstanceId: 'rt-1' },
      currentRelease: { id: 'r-older' },
    })

    // Act
    const result = computeDrift(runtime, [release({ id: 'r-3' }), release({ id: 'r-2' })])

    // Assert
    expect(result).toEqual({ kind: 'unknown' })
  })

  it('should return up-to-date when the deployed release is the newest in the window', () => {
    // Arrange
    const runtime = row({
      environment: { id: 'env-1' },
      status: 'ready',
      runtime: { runtimeInstanceId: 'rt-1' },
      currentRelease: { id: 'r-3' },
    })

    // Act
    const result = computeDrift(runtime, [
      release({ id: 'r-3' }),
      release({ id: 'r-2' }),
      release({ id: 'r-1' }),
    ])

    // Assert
    expect(result).toEqual({ kind: 'up-to-date' })
  })

  it('should return behind with the index distance when the deployed release is older', () => {
    // Arrange
    const runtime = row({
      environment: { id: 'env-1' },
      status: 'ready',
      runtime: { runtimeInstanceId: 'rt-1' },
      currentRelease: { id: 'r-1' },
    })

    // Act
    const result = computeDrift(runtime, [
      release({ id: 'r-3' }),
      release({ id: 'r-2' }),
      release({ id: 'r-1' }),
    ])

    // Assert
    expect(result).toEqual({ kind: 'behind', steps: 2 })
  })

  it('should return unknown when the release window is empty', () => {
    // Arrange
    const runtime = row({
      environment: { id: 'env-1' },
      status: 'ready',
      runtime: { runtimeInstanceId: 'rt-1' },
      currentRelease: { id: 'r-1' },
    })

    // Act
    const result = computeDrift(runtime, [])

    // Assert
    expect(result).toEqual({ kind: 'unknown' })
  })
})

describe('latestReleaseId', () => {
  it('should return the first release id', () => {
    expect(latestReleaseId([release({ id: 'r-3' }), release({ id: 'r-2' })])).toBe('r-3')
  })

  it('should return undefined when the list is empty', () => {
    expect(latestReleaseId([])).toBeUndefined()
  })

  it('should return undefined when the first release has no id', () => {
    expect(latestReleaseId([release({})])).toBeUndefined()
  })
})

describe('computeOverviewStats', () => {
  const releases = [release({ id: 'r-3' }), release({ id: 'r-2' }), release({ id: 'r-1' })]

  it('should classify each row into a single bucket', () => {
    // Arrange
    const rows: EnvironmentDeployment[] = [
      row({ runtime: { runtimeInstanceId: 'rt-1' }, environment: { id: 'env-1' }, status: 'ready', currentRelease: { id: 'r-3' } }),
      row({ runtime: { runtimeInstanceId: 'rt-2' }, environment: { id: 'env-2' }, status: 'ready', currentRelease: { id: 'r-1' } }),
      row({ runtime: { runtimeInstanceId: 'rt-3' }, environment: { id: 'env-3' }, status: 'deploying', currentRelease: { id: 'r-3' } }),
      row({ runtime: { runtimeInstanceId: 'rt-4' }, environment: { id: 'env-4' }, status: 'deploy_failed', currentRelease: { id: 'r-2' } }),
      row({ environment: { id: 'env-5' }, status: 'undeployed' }),
    ]

    // Act
    const stats = computeOverviewStats(rows, releases)

    // Assert
    expect(stats).toEqual({ total: 5, ready: 1, behind: 1, failed: 1, deploying: 1, undeployed: 1 })
  })

  it('should not count failed envs as behind even when on an older release', () => {
    // Arrange
    const rows: EnvironmentDeployment[] = [
      row({ runtime: { runtimeInstanceId: 'rt-1' }, environment: { id: 'env-1' }, status: 'deploy_failed', currentRelease: { id: 'r-1' } }),
    ]

    // Act
    const stats = computeOverviewStats(rows, releases)

    // Assert
    expect(stats.failed).toBe(1)
    expect(stats.behind).toBe(0)
  })

  it('should return all zeros for an empty grid', () => {
    expect(computeOverviewStats([], releases)).toEqual({ total: 0, ready: 0, behind: 0, failed: 0, deploying: 0, undeployed: 0 })
  })
})
