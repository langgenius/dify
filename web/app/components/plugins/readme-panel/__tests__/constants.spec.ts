import { describe, expect, it } from 'vitest'
import { BUILTIN_TOOLS_ARRAY } from '../constants'

describe('BUILTIN_TOOLS_ARRAY', () => {
  it('should contain expected builtin tools', () => {
    expect(BUILTIN_TOOLS_ARRAY).toContain('code')
    expect(BUILTIN_TOOLS_ARRAY).toContain('audio')
    expect(BUILTIN_TOOLS_ARRAY).toContain('time')
    expect(BUILTIN_TOOLS_ARRAY).toContain('webscraper')
  })

  it('should have exactly 4 builtin tools', () => {
    expect(BUILTIN_TOOLS_ARRAY).toHaveLength(4)
  })

  it('should be an array of strings', () => {
    for (const tool of BUILTIN_TOOLS_ARRAY)
      expect(typeof tool).toBe('string')
  })
})
