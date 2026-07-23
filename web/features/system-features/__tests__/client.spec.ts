import { describe, expect, it } from 'vitest'
import { systemFeaturesQueryOptions } from '../client'

describe('systemFeaturesQueryOptions', () => {
  it('keeps deployment configuration fresh until explicitly invalidated', () => {
    expect(systemFeaturesQueryOptions().staleTime).toBe(Infinity)
  })
})
