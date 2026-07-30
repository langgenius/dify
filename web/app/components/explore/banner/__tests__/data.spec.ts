import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getHomeBanners } from '../data'

const mocks = vi.hoisted(() => ({
  getBanners: vi.fn(),
  getContext: vi.fn(),
  getLocale: vi.fn(),
}))

vi.mock('server-only', () => ({}))

vi.mock('@/i18n-config/server', () => ({
  getLocaleOnServer: mocks.getLocale,
}))

vi.mock('@/service/server', () => ({
  getServerConsoleClientContext: mocks.getContext,
  serverConsoleClient: {
    explore: {
      banners: {
        get: mocks.getBanners,
      },
    },
  },
}))

describe('getHomeBanners', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getLocale.mockResolvedValue('en-US')
    mocks.getContext.mockResolvedValue({
      cookie: 'access_token=session',
      csrfToken: 'csrf-token',
    })
  })

  it('should forward locale and request context while normalizing banner data', async () => {
    mocks.getBanners.mockResolvedValue([
      {
        id: 'banner-1',
        content: {
          category: 'Featured',
          title: 'Build an agent',
          description: 'Start with a template',
          'img-src': 'https://assets.dify.ai/banner.png',
        },
        link: null,
        sort: 1,
        status: 'enabled',
        created_at: null,
      },
    ])

    await expect(getHomeBanners()).resolves.toEqual([
      {
        id: 'banner-1',
        content: {
          category: 'Featured',
          title: 'Build an agent',
          description: 'Start with a template',
          'img-src': 'https://assets.dify.ai/banner.png',
        },
        link: '',
        sort: 1,
        status: 'enabled',
        created_at: '',
      },
    ])
    expect(mocks.getBanners).toHaveBeenCalledWith(
      {
        query: { language: 'en-US' },
      },
      {
        context: {
          cookie: 'access_token=session',
          csrfToken: 'csrf-token',
        },
      },
    )
  })

  it('should normalize malformed optional content fields without widening the API boundary', async () => {
    mocks.getBanners.mockResolvedValue([
      {
        id: 'banner-2',
        content: null,
        link: 'https://example.com',
        sort: 2,
        status: 'enabled',
        created_at: '2026-07-29T00:00:00Z',
      },
    ])

    await expect(getHomeBanners()).resolves.toEqual([
      {
        id: 'banner-2',
        content: {
          category: '',
          title: '',
          description: '',
          'img-src': '',
        },
        link: 'https://example.com',
        sort: 2,
        status: 'enabled',
        created_at: '2026-07-29T00:00:00Z',
      },
    ])
  })
})
