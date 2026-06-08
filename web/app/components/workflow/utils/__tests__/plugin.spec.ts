import { extractPluginId } from '../plugin'

describe('extractPluginId', () => {
  it('returns the provider prefix for nested plugin paths', () => {
    expect(extractPluginId('langgenius/openai/tools/chat')).toBe('langgenius/openai')
  })

  it('returns the original provider when it has no nested path', () => {
    expect(extractPluginId('langgenius')).toBe('langgenius')
  })
})
