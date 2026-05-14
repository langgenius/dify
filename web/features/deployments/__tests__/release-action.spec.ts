import type { ReleaseRow, ReleaseSummary } from '@dify/contracts/enterprise/types.gen'
import { describe, expect, it } from 'vitest'
import { releaseDeploymentAction } from '../release-action'

function release(overrides: ReleaseRow): ReleaseRow {
  return overrides
}

function currentRelease(overrides: ReleaseSummary): ReleaseSummary {
  return overrides
}

describe('releaseDeploymentAction', () => {
  describe('deploy actions', () => {
    it('should return deploy when the target environment has no current release', () => {
      // Arrange
      const releases = [
        release({ id: 'release-2', createdAt: '2026-01-02T00:00:00Z' }),
      ]

      // Act
      const action = releaseDeploymentAction({
        targetRelease: releases[0],
        releaseRows: releases,
      })

      // Assert
      expect(action).toBe('deploy')
    })

    it('should return deployExistingRelease when a preset release is deployed to a new environment', () => {
      // Arrange
      const releases = [
        release({ id: 'release-2', createdAt: '2026-01-02T00:00:00Z' }),
      ]

      // Act
      const action = releaseDeploymentAction({
        targetRelease: releases[0],
        releaseRows: releases,
        isExistingRelease: true,
      })

      // Assert
      expect(action).toBe('deployExistingRelease')
    })
  })

  describe('release direction', () => {
    it('should return promote when the target release is newer than the current release', () => {
      // Arrange
      const releases = [
        release({ id: 'release-3', createdAt: '2026-01-03T00:00:00Z' }),
        release({ id: 'release-2', createdAt: '2026-01-02T00:00:00Z' }),
      ]

      // Act
      const action = releaseDeploymentAction({
        targetRelease: releases[0],
        currentRelease: currentRelease({ id: 'release-2', createdAt: '2026-01-02T00:00:00Z' }),
        releaseRows: releases,
        isExistingRelease: true,
      })

      // Assert
      expect(action).toBe('promote')
    })

    it('should return rollback when the target release is older than the current release', () => {
      // Arrange
      const releases = [
        release({ id: 'release-3', createdAt: '2026-01-03T00:00:00Z' }),
        release({ id: 'release-2', createdAt: '2026-01-02T00:00:00Z' }),
      ]

      // Act
      const action = releaseDeploymentAction({
        targetRelease: releases[1],
        currentRelease: currentRelease({ id: 'release-3', createdAt: '2026-01-03T00:00:00Z' }),
        releaseRows: releases,
        isExistingRelease: true,
      })

      // Assert
      expect(action).toBe('rollback')
    })

    it('should fall back to release list order when release timestamps are unavailable', () => {
      // Arrange
      const releases = [
        release({ id: 'release-3' }),
        release({ id: 'release-2' }),
        release({ id: 'release-1' }),
      ]

      // Act
      const rollbackAction = releaseDeploymentAction({
        targetRelease: releases[2],
        currentRelease: currentRelease({ id: 'release-2' }),
        releaseRows: releases,
      })
      const promoteAction = releaseDeploymentAction({
        targetRelease: releases[0],
        currentRelease: currentRelease({ id: 'release-2' }),
        releaseRows: releases,
      })

      // Assert
      expect(rollbackAction).toBe('rollback')
      expect(promoteAction).toBe('promote')
    })
  })
})
