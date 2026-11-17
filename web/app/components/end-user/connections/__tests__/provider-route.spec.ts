import { describe, expect, it } from 'vite-plus/test'
import { decodeConnectionProviderRouteParam } from '../provider-route'

describe('decodeConnectionProviderRouteParam', () => {
  it('decodes the URI-encoded provider segment once before it reaches the API client', () => {
    expect(decodeConnectionProviderRouteParam('langgenius%2Fgithub%2Fgithub')).toBe(
      'langgenius/github/github',
    )
  })

  it('retains malformed route parameters without throwing', () => {
    expect(decodeConnectionProviderRouteParam('invalid%provider')).toBe('invalid%provider')
  })
})
