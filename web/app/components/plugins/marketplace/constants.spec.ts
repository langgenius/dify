import { describe, expect, it } from 'vitest'
import { getValidatedPluginCategory } from './constants'

describe('getValidatedPluginCategory', () => {
  it('returns agent-strategy when query value is agent-strategy', () => {
    expect(getValidatedPluginCategory('agent-strategy')).toBe('agent-strategy')
  })

  it('returns valid category values unchanged', () => {
    expect(getValidatedPluginCategory('model')).toBe('model')
    expect(getValidatedPluginCategory('tool')).toBe('tool')
    expect(getValidatedPluginCategory('bundle')).toBe('bundle')
  })

  it('falls back to all for invalid category values', () => {
    expect(getValidatedPluginCategory('agent')).toBe('all')
    expect(getValidatedPluginCategory('invalid-category')).toBe('all')
  })
})
