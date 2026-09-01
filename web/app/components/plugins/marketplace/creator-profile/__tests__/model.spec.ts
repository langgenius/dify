import type {
  MarketplaceCreator,
  MarketplacePlugin,
  MarketplaceTemplate,
} from '@dify/contracts/marketplace'
import { describe, expect, it } from 'vitest'
import {
  adaptCreatorProfile,
  getStandaloneCreationHref,
  normalizeCreatorSocialLink,
  parseCreatorSortField,
  parseCreatorSortOrder,
  sortCreatorCreations,
  toPublisherSortQuery,
} from '../model'

const creator: MarketplaceCreator = {
  unique_handle: 'evanz',
  display_name: 'Evan.Z',
  social_links: ['github.com/evanz', 'javascript:alert(1)'],
  badges: ['partner'],
  verified: true,
}

const plugin = {
  type: 'bundle',
  org: 'dify',
  name: 'research',
  labels: { en_US: 'Research bundle' },
  description: { en_US: 'Research reliably.' },
  install_count: 20,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-02-01T00:00:00Z',
} as unknown as MarketplacePlugin

const template = {
  id: 'template/one',
  template_name: 'Research template',
  overview: 'Start a research app.',
  icon: '📄',
  icon_background: '#fff',
  icon_file_key: '',
  publisher_unique_handle: 'dify',
  usage_count: 10,
  categories: [],
  deps_plugins: ['dify/search'],
  created_at: '2026-01-02T00:00:00Z',
  updated_at: '2026-02-02T00:00:00Z',
} as MarketplaceTemplate

describe('creator profile model', () => {
  it('normalizes DTOs into host-neutral creation targets and safe social links', () => {
    const viewModel = adaptCreatorProfile({
      creator,
      kind: 'organization',
      locale: 'en-US',
      avatarUrl: '/avatar',
      backgroundUrl: '/background',
      plugins: [plugin],
      templates: [template],
      resolvePluginIcon: () => '/plugin-icon',
      resolveTemplateIcon: () => '',
      resolveDependencyIcon: (id) => `/dependency/${id}`,
    })

    expect(viewModel.profile.badges).toEqual(['partner', 'verified'])
    expect(viewModel.profile.socialLinks).toEqual([
      expect.objectContaining({ platform: 'github', href: 'https://github.com/evanz' }),
    ])
    expect(viewModel.creations[0]).toMatchObject({
      title: 'Research bundle',
      target: { type: 'plugin', pluginType: 'bundle', org: 'dify', name: 'research' },
    })
    expect(viewModel.creations[1]).toMatchObject({
      target: {
        type: 'template',
        id: 'template/one',
        publisher: 'dify',
        templateName: 'Research template',
      },
      dependencyCount: 1,
    })
  })

  it('builds standalone plugin, bundle, and template URLs outside the shared model', () => {
    const viewModel = adaptCreatorProfile({
      creator,
      kind: 'individual',
      locale: 'en-US',
      avatarUrl: '',
      backgroundUrl: '',
      plugins: [plugin],
      templates: [template],
      resolvePluginIcon: () => '',
      resolveTemplateIcon: () => '',
      resolveDependencyIcon: () => '',
    })

    expect(getStandaloneCreationHref(viewModel.creations[0]!, 'zh-Hans')).toBe(
      '/bundles/dify/research?language=zh-Hans',
    )
    expect(getStandaloneCreationHref(viewModel.creations[1]!, 'zh-Hans')).toBe(
      '/template/dify/Research%20template?templateId=template%2Fone&creationType=templates&language=zh-Hans',
    )
  })

  it('normalizes Unix-second, Unix-millisecond, and ISO timestamps', () => {
    const unixSeconds = 1_767_225_600
    const unixMilliseconds = 1_767_225_700_000
    const viewModel = adaptCreatorProfile({
      creator,
      kind: 'individual',
      locale: 'en-US',
      avatarUrl: '',
      backgroundUrl: '',
      plugins: [
        {
          ...plugin,
          created_at: unixSeconds,
          version_updated_at: unixSeconds + 100,
        },
      ],
      templates: [
        {
          ...template,
          created_at: '2026-01-02T00:00:00Z',
          updated_at: unixMilliseconds,
        },
      ],
      resolvePluginIcon: () => '',
      resolveTemplateIcon: () => '',
      resolveDependencyIcon: () => '',
    })

    expect(viewModel.creations[0]).toMatchObject({
      createdAt: unixSeconds * 1000,
      updatedAt: (unixSeconds + 100) * 1000,
    })
    expect(viewModel.creations[1]).toMatchObject({
      createdAt: Date.parse('2026-01-02T00:00:00Z'),
      updatedAt: unixMilliseconds,
    })
  })

  it('maps each UI sort onto the matching plugin and template API columns', () => {
    expect(toPublisherSortQuery('updatedAt', 'desc')).toEqual({
      plugins: { sort_by: 'version_updated_at', sort_order: 'DESC' },
      templates: { sort_by: 'updated_at', sort_order: 'DESC' },
    })
    expect(toPublisherSortQuery('createdAt', 'asc')).toEqual({
      plugins: { sort_by: 'created_at', sort_order: 'ASC' },
      templates: { sort_by: 'created_at', sort_order: 'ASC' },
    })
    expect(toPublisherSortQuery('popularity', 'desc')).toEqual({
      plugins: { sort_by: 'install_count', sort_order: 'DESC' },
      templates: { sort_by: 'usage_count', sort_order: 'DESC' },
    })
  })

  it('falls back to recently updated descending for unknown URL sort values', () => {
    expect(parseCreatorSortField('garbage')).toBe('updatedAt')
    expect(parseCreatorSortField(undefined)).toBe('updatedAt')
    expect(parseCreatorSortOrder('sideways')).toBe('desc')
    expect(parseCreatorSortOrder('ASC')).toBe('asc')
  })

  it('sorts all fields in both directions and preserves equal-value order', () => {
    const creations = [
      { id: 'first', updatedAt: 1, createdAt: 3, popularity: 2 },
      { id: 'second', updatedAt: 1, createdAt: 2, popularity: 3 },
      { id: 'third', updatedAt: 2, createdAt: 1, popularity: 1 },
    ] as ReturnType<typeof adaptCreatorProfile>['creations']

    expect(sortCreatorCreations(creations, 'updatedAt', 'asc').map(({ id }) => id)).toEqual([
      'first',
      'second',
      'third',
    ])
    expect(sortCreatorCreations(creations, 'createdAt', 'desc').map(({ id }) => id)).toEqual([
      'first',
      'second',
      'third',
    ])
    expect(sortCreatorCreations(creations, 'popularity', 'desc').map(({ id }) => id)).toEqual([
      'second',
      'first',
      'third',
    ])
  })

  it('rejects unsafe URL schemes', () => {
    expect(normalizeCreatorSocialLink('data:text/html,bad')).toBeNull()
    expect(normalizeCreatorSocialLink('mailto:test@example.com')).toBeNull()
  })
})
