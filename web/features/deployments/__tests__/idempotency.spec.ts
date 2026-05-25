import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDeploymentIdempotencyKey } from '../idempotency'

describe('createDeploymentIdempotencyKey', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('should use crypto random UUID when available', () => {
    // Arrange
    const randomUUID = vi.fn(() => 'f850a011-4679-40b4-a084-1ecf4c0b94d0')
    vi.stubGlobal('crypto', { randomUUID })

    // Act
    const key = createDeploymentIdempotencyKey()

    // Assert
    expect(key).toBe('f850a011-4679-40b4-a084-1ecf4c0b94d0')
    expect(randomUUID).toHaveBeenCalledTimes(1)
  })

  it('should generate a bounded fallback key without crypto random UUID', () => {
    // Arrange
    vi.stubGlobal('crypto', {})
    vi.spyOn(Date, 'now').mockReturnValue(1710000000000)
    vi.spyOn(Math, 'random').mockReturnValue(0.123456789)

    // Act
    const key = createDeploymentIdempotencyKey()

    // Assert
    expect(key).toBe('deployment-ltk9ukg0-4fzzzxjy')
    expect(key.length).toBeGreaterThanOrEqual(1)
    expect(key.length).toBeLessThanOrEqual(128)
  })
})
