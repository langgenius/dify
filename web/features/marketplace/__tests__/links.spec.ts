import { describe, expect, it, vi } from 'vite-plus/test'
import {
  getCreatorCenterUrl,
  getPluginDetailPath,
  getTemplateDetailPath,
  marketplaceLinks,
  PUBLIC_CREATOR_CENTER_URL,
  rewriteMarketplaceOriginToCreators,
} from '../links'

vi.mock('@/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/env')>()
  return {
    ...actual,
    env: {
      ...actual.env,
      NEXT_PUBLIC_MARKETPLACE_URL_PREFIX: 'https://marketplace.dify.ai',
      NEXT_PUBLIC_WEB_PREFIX: '',
    },
  }
})

describe('marketplaceLinks.page', () => {
  it('adds defined params and skips undefined ones', () => {
    const url = new URL(marketplaceLinks.page('/plugins', { category: 'ai', version: undefined }))

    expect(url.origin + url.pathname).toBe('https://marketplace.dify.ai/plugins')
    expect(Object.fromEntries(url.searchParams)).toEqual({ category: 'ai' })
  })

  it('reduces the source to its origin without double encoding', () => {
    const url = marketplaceLinks.page('/plugins', { category: 'ai' }, 'https://example.com/app')

    expect(url).toContain('source=https%3A%2F%2Fexample.com')
    expect(url).not.toContain('source=https%253A%252F%252Fexample.com')
  })

  it('lets params replace the source without duplicating it', () => {
    const url = new URL(
      marketplaceLinks.page(
        '/plugins',
        { source: 'http://localhost:3001', language: 'en-US' },
        'http://localhost:3000',
      ),
    )

    expect(url.searchParams.getAll('source')).toEqual(['http://localhost:3001'])
    expect(url.searchParams.get('language')).toBe('en-US')
  })

  it('does not append an empty query string', () => {
    expect(marketplaceLinks.page('/plugins')).toBe('https://marketplace.dify.ai/plugins')
  })
})

describe('plugin links', () => {
  it.each([
    { type: 'plugin' as const, collection: 'plugins', detail: 'plugin' },
    { type: 'bundle' as const, collection: 'bundles', detail: 'bundles' },
  ])('builds $type links', ({ type, collection, detail }) => {
    const plugin = { type, org: 'test-org', name: 'test-plugin' }

    expect(marketplaceLinks.plugin(plugin)).toBe(
      `https://marketplace.dify.ai/${collection}/test-org/test-plugin`,
    )
    expect(getPluginDetailPath(plugin)).toBe(`/${detail}/test-org/test-plugin`)
  })

  it('builds category links', () => {
    expect(marketplaceLinks.category()).toBe('https://marketplace.dify.ai/plugins')
    expect(marketplaceLinks.category('tool', { theme: 'dark' })).toBe(
      'https://marketplace.dify.ai/plugins/tool?theme=dark',
    )
  })
})

describe('getTemplateDetailPath', () => {
  it('keeps the same link after a title change and prefers the unique handle', () => {
    const template = {
      id: '5d107b52-8d4d-447b-9bad-1c5c16b01721',
      publisher_handle: 'Dify Display Name',
      publisher_unique_handle: 'dify-unique',
    }

    expect(getTemplateDetailPath(template)).toBe(
      '/template/dify-unique/5d107b52-8d4d-447b-9bad-1c5c16b01721',
    )
  })

  it('encodes both path segments and falls back to the publisher handle', () => {
    expect(
      getTemplateDetailPath({
        id: 'template/one',
        publisher_handle: 'Research / 团队',
        publisher_unique_handle: '',
      }),
    ).toBe('/template/Research%20%2F%20%E5%9B%A2%E9%98%9F/template%2Fone')
  })

  it('uses the template fallback when publisher handles are absent', () => {
    expect(getTemplateDetailPath({ id: 'template-2' })).toBe('/template/template/template-2')
  })
})

describe('marketplaceLinks.template', () => {
  it('preserves embedded context while dropping legacy identity parameters', () => {
    const link = new URL(
      marketplaceLinks.template(
        { id: 'template-1', publisher_handle: 'Display Name', publisher_unique_handle: 'dify' },
        {
          tid: 'legacy-short-id',
          templateId: 'legacy-id',
          creationType: 'templates',
          language: 'zh-Hans',
          theme: 'dark',
          source: 'https://cloud.dify.ai',
          view: 'modal',
        },
      ),
    )

    expect(link.origin + link.pathname).toBe('https://marketplace.dify.ai/template/dify/template-1')
    expect(Object.fromEntries(link.searchParams)).toEqual({
      language: 'zh-Hans',
      theme: 'dark',
      source: 'https://cloud.dify.ai',
      view: 'modal',
    })
  })
})

describe('creator center', () => {
  it.each([
    ['https://marketplace.dify.ai', 'https://creators.dify.ai/'],
    ['https://marketplace.dify.dev', 'https://creators.dify.dev/'],
    ['https://marketplace-staging.dify.dev', 'https://creators-staging.dify.dev/'],
  ])('maps %s to %s', (origin, creators) => {
    expect(rewriteMarketplaceOriginToCreators(origin)).toBe(creators)
  })

  it('returns null for hosts that are not a Marketplace surface', () => {
    expect(rewriteMarketplaceOriginToCreators('https://cloud.dify.ai')).toBeNull()
    expect(rewriteMarketplaceOriginToCreators('http://localhost:3000')).toBeNull()
    expect(rewriteMarketplaceOriginToCreators('')).toBeNull()
  })

  it('prefers the current Marketplace page over the configured prefix', () => {
    expect(getCreatorCenterUrl('https://marketplace.dify.dev')).toBe('https://creators.dify.dev/')
    expect(getCreatorCenterUrl('http://localhost:3000')).toBe('https://creators.dify.ai/')
    expect(marketplaceLinks.creatorCenter).toBe('https://creators.dify.ai/')
  })

  it('exposes the public Creator Center fallback', () => {
    expect(PUBLIC_CREATOR_CENTER_URL).toBe('https://creators.dify.ai/')
  })
})

describe('official detail links', () => {
  it('opens plugin and template details on the official Marketplace', () => {
    const params = { language: 'en-US', theme: 'dark' }

    expect(
      marketplaceLinks.officialPluginDetail(
        { org: 'org', name: 'plugin' },
        params,
        'https://dify.example.com/app',
      ),
    ).toBe(
      'https://marketplace.dify.ai/plugin/org/plugin?source=https%3A%2F%2Fdify.example.com&language=en-US&theme=dark',
    )
    expect(
      marketplaceLinks.officialTemplateDetail(
        { id: 'template-1' },
        params,
        'https://dify.example.com',
      ),
    ).toBe(
      'https://marketplace.dify.ai/template/template/template-1?source=https%3A%2F%2Fdify.example.com&language=en-US&theme=dark',
    )
  })
})
