import type { MarketplacePlugin, MarketplaceTemplate } from '@dify/contracts/marketplace'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadCreatorProfile } from '../data.server'

const mocks = vi.hoisted(() => ({
  creatorDetail: vi.fn(),
  organizationDetail: vi.fn(),
  publisherPlugins: vi.fn(),
  publisherTemplates: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/config', () => ({ MARKETPLACE_API_PREFIX: 'https://marketplace.example/api/v1' }))
vi.mock('@/service/client', () => ({ marketplaceClient: mocks }))

const plugin = {
  type: 'plugin',
  org: 'dify',
  name: 'search',
  plugin_id: 'dify/search',
  label: { en_US: 'Search' },
  brief: { en_US: 'Search the web.' },
  tags: [],
} as unknown as MarketplacePlugin

const template = {
  id: 'template-one',
  template_name: 'Template one',
  overview: 'Build an app.',
  icon: '📄',
  icon_background: '#fff',
  icon_file_key: '',
  usage_count: 1,
  categories: [],
} as MarketplaceTemplate

describe('loadCreatorProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.creatorDetail.mockResolvedValue({
      data: {
        creator: {
          unique_handle: 'creator',
          display_name: 'Creator',
          social_links: [],
        },
      },
    })
    mocks.organizationDetail.mockResolvedValue({ data: {} })
    mocks.publisherPlugins.mockResolvedValue({ data: { plugins: [plugin] } })
    mocks.publisherTemplates.mockResolvedValue({ data: { templates: [template] } })
  })

  it('loads individual data through all publisher contracts', async () => {
    const loaded = await loadCreatorProfile({
      uniqueHandle: 'creator-one',
      locale: 'en-US',
    })

    expect(mocks.creatorDetail).toHaveBeenCalledWith({
      params: { uniqueHandle: 'creator-one' },
    })
    expect(mocks.publisherPlugins).toHaveBeenCalledWith({
      params: { uniqueHandle: 'creator-one' },
      query: { page: 1, page_size: 40, sort_by: 'version_updated_at', sort_order: 'DESC' },
    })
    expect(loaded?.viewModel.creations).toHaveLength(2)
    expect(loaded?.pluginsByCreationId['plugin:dify/search']).toBeDefined()
    expect(loaded?.viewModel.profile.backgroundUrl).toBe('')
    expect(loaded?.viewModel.profile.avatarUrl).toBe('')
  })

  it('only emits the remote background URL when the API reports an uploaded background', async () => {
    mocks.creatorDetail.mockResolvedValue({
      data: {
        creator: {
          unique_handle: 'creator-with-background',
          display_name: 'Creator with background',
          background_image: 'creator/background.png',
          social_links: [],
        },
      },
    })

    const loaded = await loadCreatorProfile({
      uniqueHandle: 'creator-with-background',
      locale: 'en-US',
    })

    expect(loaded?.viewModel.profile.backgroundUrl).toBe(
      'https://marketplace.example/api/v1/creators/creator-with-background/background-image',
    )
  })

  it('only emits the remote avatar URL when the API reports an uploaded avatar', async () => {
    mocks.creatorDetail.mockResolvedValue({
      data: {
        creator: {
          unique_handle: 'creator-with-avatar',
          display_name: 'Creator with avatar',
          avatar: 'creator/avatar.png',
          social_links: [],
        },
      },
    })

    const loaded = await loadCreatorProfile({
      uniqueHandle: 'creator-with-avatar',
      locale: 'en-US',
    })

    expect(loaded?.viewModel.profile.avatarUrl).toBe(
      'https://marketplace.example/api/v1/creators/creator-with-avatar/avatar',
    )
  })

  it('loads evanz from the Marketplace API without a development fixture branch', async () => {
    await loadCreatorProfile({ uniqueHandle: 'evanz', locale: 'en-US' })

    expect(mocks.creatorDetail).toHaveBeenCalledWith({ params: { uniqueHandle: 'evanz' } })
    expect(mocks.publisherTemplates).toHaveBeenCalledWith({
      params: { uniqueHandle: 'evanz' },
      query: { page: 1, page_size: 40, sort_by: 'updated_at', sort_order: 'DESC' },
    })
  })

  it('forwards popularity sort to each publisher API column', async () => {
    await loadCreatorProfile({
      uniqueHandle: 'creator-one',
      locale: 'en-US',
      sortBy: 'popularity',
      sortOrder: 'asc',
    })

    expect(mocks.publisherPlugins).toHaveBeenCalledWith({
      params: { uniqueHandle: 'creator-one' },
      query: { page: 1, page_size: 40, sort_by: 'install_count', sort_order: 'ASC' },
    })
    expect(mocks.publisherTemplates).toHaveBeenCalledWith({
      params: { uniqueHandle: 'creator-one' },
      query: { page: 1, page_size: 40, sort_by: 'usage_count', sort_order: 'ASC' },
    })
  })

  it('merge-sorts mixed creations after the publisher responses return', async () => {
    mocks.publisherPlugins.mockResolvedValue({
      data: {
        plugins: [{ ...plugin, install_count: 2, created_at: '2026-01-01T00:00:00Z' }],
      },
    })
    mocks.publisherTemplates.mockResolvedValue({
      data: {
        templates: [{ ...template, usage_count: 5, created_at: '2026-01-02T00:00:00Z' }],
      },
    })

    const loaded = await loadCreatorProfile({
      uniqueHandle: 'creator-one',
      locale: 'en-US',
      sortBy: 'popularity',
      sortOrder: 'desc',
    })

    expect(loaded?.viewModel.creations.map(({ kind }) => kind)).toEqual(['template', 'plugin'])
  })

  it('fetches remaining publisher pages until the reported total is loaded', async () => {
    const extraPlugin = {
      ...plugin,
      name: 'extra',
      plugin_id: 'dify/extra',
    } as MarketplacePlugin
    mocks.publisherPlugins
      .mockResolvedValueOnce({
        data: { plugins: [plugin], total: 2 },
      })
      .mockResolvedValueOnce({
        data: { plugins: [extraPlugin], total: 2 },
      })

    const loaded = await loadCreatorProfile({
      uniqueHandle: 'paged-creator',
      locale: 'en-US',
    })

    expect(mocks.publisherPlugins).toHaveBeenNthCalledWith(1, {
      params: { uniqueHandle: 'paged-creator' },
      query: { page: 1, page_size: 40, sort_by: 'version_updated_at', sort_order: 'DESC' },
    })
    expect(mocks.publisherPlugins).toHaveBeenNthCalledWith(2, {
      params: { uniqueHandle: 'paged-creator' },
      query: { page: 2, page_size: 40, sort_by: 'version_updated_at', sort_order: 'DESC' },
    })
    expect(loaded?.pluginsByCreationId['plugin:dify/search']).toBeDefined()
    expect(loaded?.pluginsByCreationId['plugin:dify/extra']).toBeDefined()
  })

  it('keeps successful creations when one publisher request fails', async () => {
    mocks.publisherPlugins.mockRejectedValue(new Error('plugin request failed'))

    const loaded = await loadCreatorProfile({
      uniqueHandle: 'creator-partial',
      locale: 'en-US',
    })

    expect(loaded?.viewModel.creations.map(({ kind }) => kind)).toEqual(['template'])
  })

  it('returns null when the primary creator does not exist', async () => {
    mocks.creatorDetail.mockResolvedValue({ data: {} })

    await expect(
      loadCreatorProfile({ uniqueHandle: 'missing-creator', locale: 'en-US' }),
    ).resolves.toBeNull()
  })

  it('rethrows when the primary creator request fails', async () => {
    mocks.creatorDetail.mockRejectedValue(new Error('creator request timed out'))

    await expect(
      loadCreatorProfile({ uniqueHandle: 'slow-creator', locale: 'en-US' }),
    ).rejects.toThrow('creator request timed out')
  })

  it('rethrows when the organization request fails', async () => {
    mocks.organizationDetail.mockRejectedValue(new Error('organization request timed out'))

    await expect(
      loadCreatorProfile({
        uniqueHandle: 'slow-org',
        publisherType: 'organization',
        locale: 'en-US',
      }),
    ).rejects.toThrow('organization request timed out')
  })

  it('maps organizations to the shared creator profile shape', async () => {
    mocks.organizationDetail.mockResolvedValue({
      data: {
        organization: {
          id: 'org-id',
          unique_handle: 'dify-org',
          display_name: 'Dify Org',
          social_links: [],
        },
      },
    })

    const loaded = await loadCreatorProfile({
      uniqueHandle: 'dify-org',
      publisherType: 'organization',
      locale: 'en-US',
    })

    expect(mocks.organizationDetail).toHaveBeenCalledWith({ params: { id: 'dify-org' } })
    expect(loaded?.viewModel.profile).toMatchObject({
      kind: 'organization',
      displayName: 'Dify Org',
    })
  })
})
