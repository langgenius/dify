import type { PluginDeclaration, PluginManifestInMarket } from '../../types'
import { describe, expect, it } from 'vite-plus/test'
import { PluginCategoryEnum } from '../../types'
import {
  convertRepoToUrl,
  parseGitHubUrl,
  pluginDeclarationToCardPluginProps,
  pluginManifestInMarketToPluginProps,
  pluginManifestToCardPluginProps,
  toPluginText,
} from '../utils'

describe('pluginManifestToCardPluginProps', () => {
  const createMockPluginDeclaration = (
    overrides?: Partial<PluginDeclaration>,
  ): PluginDeclaration => ({
    plugin_unique_identifier: 'test-plugin-123',
    version: '1.0.0',
    author: 'test-author',
    icon: '/test-icon.png',
    name: 'test-plugin',
    category: PluginCategoryEnum.tool,
    label: { 'en-US': 'Test Plugin' } as Record<string, string>,
    description: { 'en-US': 'Test description' } as Record<string, string>,
    created_at: '2024-01-01',
    resource: {},
    plugins: {},
    verified: true,
    endpoint: { settings: [], endpoints: [] },
    model: {},
    tags: ['search', 'api'],
    agent_strategy: null,
    meta: { version: '1.0.0' },
    trigger: {} as PluginDeclaration['trigger'],
    ...overrides,
  })

  it('converts a package manifest into its card identity and metadata', () => {
    const manifest = createMockPluginDeclaration({
      category: PluginCategoryEnum.model,
      label: {
        ...createMockPluginDeclaration().label,
        'en-US': 'My Plugin',
        'zh-Hans': '我的插件',
      },
      icon_dark: '/dark-icon.png',
    })
    expect(pluginManifestToCardPluginProps(manifest)).toEqual({
      plugin_id: 'test-plugin-123',
      type: PluginCategoryEnum.model,
      category: PluginCategoryEnum.model,
      name: 'test-plugin',
      version: '1.0.0',
      org: 'test-author',
      author: 'test-author',
      label: { 'en-US': 'My Plugin', 'zh-Hans': '我的插件' },
      brief: { 'en-US': 'Test description' },
      description: { 'en-US': 'Test description' },
      icon: '/test-icon.png',
      icon_dark: '/dark-icon.png',
      verified: true,
      latest_version: '',
      latest_package_identifier: '',
      introduction: '',
      repository: '',
      install_count: 0,
      endpoint: { settings: [] },
      tags: [{ name: 'search' }, { name: 'api' }],
      badges: [],
      verification: { authorized_category: 'langgenius' },
      from: 'package',
    })
  })

  it('keeps untagged package manifests untagged', () => {
    expect(pluginManifestToCardPluginProps(createMockPluginDeclaration({ tags: [] })).tags).toEqual(
      [],
    )
  })
})

describe('pluginDeclarationToCardPluginProps', () => {
  const manifest = {
    author: null,
    category: 'agent-strategy',
    created_at: '2026-01-01T00:00:00Z',
    description: { en_US: 'Description', zh_Hans: null },
    icon: 'icon.svg',
    label: { en_US: 'Agent', zh_Hans: '代理' },
    meta: { minimum_dify_version: null, version: '0.0.1' },
    name: 'agent',
    plugins: {},
    resource: { memory: 0 },
    version: '1.0.0',
  } satisfies Parameters<typeof pluginDeclarationToCardPluginProps>[0]

  it('reads the uploaded package as a card', () => {
    expect(
      pluginDeclarationToCardPluginProps(manifest, 'langgenius/agent:1.0.0@hash'),
    ).toMatchObject({
      plugin_id: 'langgenius/agent:1.0.0@hash',
      type: 'agent_strategy',
      category: 'agent-strategy',
      org: '',
      author: undefined,
      label: { en_US: 'Agent', zh_Hans: '代理' },
      description: { en_US: 'Description' },
      verified: false,
      tags: [],
    })
  })

  it('leaves untranslated locales out of card text', () => {
    expect(toPluginText({ en_US: 'Name', ja_JP: null, pt_BR: 'Nome' })).toEqual({
      en_US: 'Name',
      pt_BR: 'Nome',
    })
  })
})

describe('pluginManifestInMarketToPluginProps', () => {
  const createMockPluginManifestInMarket = (
    overrides?: Partial<PluginManifestInMarket>,
  ): PluginManifestInMarket => ({
    plugin_unique_identifier: 'market-plugin-123',
    name: 'market-plugin',
    org: 'market-org',
    icon: '/market-icon.png',
    label: { 'en-US': 'Market Plugin' } as Record<string, string>,
    category: PluginCategoryEnum.tool,
    version: '1.0.0',
    latest_version: '1.2.0',
    brief: { 'en-US': 'Market plugin description' } as Record<string, string>,
    introduction: 'Full introduction text',
    verified: true,
    install_count: 5000,
    badges: ['partner', 'verified'],
    verification: { authorized_category: 'langgenius' },
    from: 'marketplace',
    ...overrides,
  })

  it('uses the latest marketplace version and marketplace metadata for the card', () => {
    const manifest = createMockPluginManifestInMarket({ category: PluginCategoryEnum.model })
    expect(pluginManifestInMarketToPluginProps(manifest)).toEqual({
      plugin_id: 'market-plugin-123',
      type: PluginCategoryEnum.model,
      category: PluginCategoryEnum.model,
      name: 'market-plugin',
      version: '1.2.0',
      latest_version: '1.2.0',
      org: 'market-org',
      label: { 'en-US': 'Market Plugin' },
      brief: { 'en-US': 'Market plugin description' },
      description: { 'en-US': 'Market plugin description' },
      icon: '/market-icon.png',
      verified: true,
      introduction: 'Full introduction text',
      latest_package_identifier: '',
      repository: '',
      install_count: 0,
      tags: [],
      endpoint: { settings: [] },
      badges: ['partner', 'verified'],
      verification: { authorized_category: 'langgenius' },
      from: 'marketplace',
    })
  })

  it.each([
    [{ authorized_category: 'partner' }, { authorized_category: 'partner' }],
    [{}, { authorized_category: 'langgenius' }],
  ])('normalizes marketplace verification %j', (verification, expected) => {
    expect(
      pluginManifestInMarketToPluginProps(
        createMockPluginManifestInMarket({
          verification: verification as PluginManifestInMarket['verification'],
          from: 'github',
        }),
      ),
    ).toMatchObject({ verification: expected, from: 'github' })
  })
})

describe('parseGitHubUrl', () => {
  it.each([
    ['https://github.com/owner/repo', 'owner', 'repo'],
    ['https://github.com/owner/repo/', 'owner', 'repo'],
    ['https://github.com/my-org/my_repo123', 'my-org', 'my_repo123'],
  ])('parses %s', (url, owner, repo) => {
    expect(parseGitHubUrl(url)).toEqual({ isValid: true, owner, repo })
  })

  it.each([
    'https://gitlab.com/owner/repo',
    'https://github.com/owner/repo/tree/main',
    'https://github.com/owner',
    '',
    'not-a-url',
    'http://github.com/owner/repo',
    'https://www.github.com/owner/repo',
  ])('rejects %s', (url) => {
    expect(parseGitHubUrl(url)).toEqual({ isValid: false })
  })
})

describe('convertRepoToUrl', () => {
  it.each([
    [
      'organization_name/repository-name.js',
      'https://github.com/organization_name/repository-name.js',
    ],
    ['', ''],
  ])('converts %s to its repository URL', (repo, expected) => {
    expect(convertRepoToUrl(repo)).toBe(expected)
  })
})
