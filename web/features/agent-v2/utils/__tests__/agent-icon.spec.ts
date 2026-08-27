import { describe, expect, it } from 'vitest'
import { getAgentAppIconImageUrl } from '../agent-icon'

describe('getAgentAppIconImageUrl', () => {
  it('returns icon_url for image icons', () => {
    expect(
      getAgentAppIconImageUrl({
        icon_type: 'image',
        icon: '29bdb007-4d8c-4888-83a2-7587abcafb26',
        icon_url: '/files/29bdb007-4d8c-4888-83a2-7587abcafb26/file-preview?sign=abc',
      }),
    ).toBe('/files/29bdb007-4d8c-4888-83a2-7587abcafb26/file-preview?sign=abc')
  })

  it('returns icon for link icons', () => {
    expect(
      getAgentAppIconImageUrl({
        icon_type: 'link',
        icon: 'https://example.com/icon.png',
        icon_url: null,
      }),
    ).toBe('https://example.com/icon.png')
  })

  it('returns undefined for emoji icons', () => {
    expect(
      getAgentAppIconImageUrl({
        icon_type: 'emoji',
        icon: '🧪',
        icon_url: null,
      }),
    ).toBeUndefined()
  })
})
