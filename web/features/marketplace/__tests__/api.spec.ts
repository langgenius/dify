import { describe, expect, it, vi } from 'vite-plus/test'
import {
  getMarketplaceApiUrl,
  getMarketplacePluginIconUrl,
  getMarketplaceTemplateIconUrl,
  resolveMarketplaceAssetUrl,
} from '../api'

vi.mock('@/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/env')>()
  return {
    ...actual,
    env: {
      ...actual.env,
      NEXT_PUBLIC_MARKETPLACE_API_PREFIX: 'https://marketplace.dify.ai/api/v1/',
    },
  }
})

describe('marketplace asset urls', () => {
  it('joins API paths without duplicate slashes', () => {
    expect(getMarketplaceApiUrl('/creators/dify/avatar')).toBe(
      'https://marketplace.dify.ai/api/v1/creators/dify/avatar',
    )
  })

  it('builds plugin and bundle icons with encoded segments', () => {
    expect(getMarketplacePluginIconUrl('langgenius/openai')).toBe(
      'https://marketplace.dify.ai/api/v1/plugins/langgenius/openai/icon',
    )
    expect(getMarketplacePluginIconUrl('org/my bundle', 'bundle')).toBe(
      'https://marketplace.dify.ai/api/v1/bundles/org/my%20bundle/icon',
    )
  })

  it('builds template icons', () => {
    expect(getMarketplaceTemplateIconUrl('template/1')).toBe(
      'https://marketplace.dify.ai/api/v1/templates/template%2F1/icon',
    )
  })

  it.each([
    [undefined, ''],
    ['https://cdn.example.com/a.png', 'https://cdn.example.com/a.png'],
    ['/_next/static/a.png', '/_next/static/a.png'],
    ['/api/banners/a.png', 'https://marketplace.dify.ai/api/banners/a.png'],
    ['banners/a.png', 'https://marketplace.dify.ai/api/v1/banners/a.png'],
  ])('resolves asset path %s', (path, expected) => {
    expect(resolveMarketplaceAssetUrl(path)).toBe(expected)
  })
})
