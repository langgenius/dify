import type { PluginDeclaration, PluginManifestInMarket } from '../types'
import { describe, expect, it, vi } from 'vitest'
import { PluginCategoryEnum } from '../types'
import {
  convertRepoToUrl,
  parseGitHubUrl,
  pluginManifestInMarketToPluginProps,
  pluginManifestToCardPluginProps,
} from './utils'

// Mock es-toolkit/compat
vi.mock('es-toolkit/compat', () => ({
  isEmpty: (obj: unknown) => {
    if (obj === null || obj === undefined)
      return true
    if (typeof obj === 'object')
      return Object.keys(obj).length === 0
    return false
  },
}))

describe('pluginManifestToCardPluginProps', () => {
  const createMockPluginDeclaration = (overrides?: Partial<PluginDeclaration>): PluginDeclaration => ({
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
    agent_strategy: {},
    meta: { version: '1.0.0' },
    trigger: {} as PluginDeclaration['trigger'],
    ...overrides,
  })

  describe('Basic Conversion', () => {
    it('should convert plugin_unique_identifier to plugin_id', () => {
      const manifest = createMockPluginDeclaration()
      const result = pluginManifestToCardPluginProps(manifest)

      expect(result.plugin_id).toBe('test-plugin-123')
    })

    it('should convert category to type', () => {
      const manifest = createMockPluginDeclaration({ category: PluginCategoryEnum.model })
      const result = pluginManifestToCardPluginProps(manifest)

      expect(result.type).toBe(PluginCategoryEnum.model)
      expect(result.category).toBe(PluginCategoryEnum.model)
    })

    it('should map author to org', () => {
      const manifest = createMockPluginDeclaration({ author: 'my-org' })
      const result = pluginManifestToCardPluginProps(manifest)

      expect(result.org).toBe('my-org')
      expect(result.author).toBe('my-org')
    })

    it('should map label correctly', () => {
      const manifest = createMockPluginDeclaration({
        label: { 'en-US': 'My Plugin', 'zh-Hans': '我的插件' } as Record<string, string>,
      })
      const result = pluginManifestToCardPluginProps(manifest)

      expect(result.label).toEqual({ 'en-US': 'My Plugin', 'zh-Hans': '我的插件' })
    })

    it('should map description to brief and description', () => {
      const manifest = createMockPluginDeclaration({
        description: { 'en-US': 'Plugin description' } as Record<string, string>,
      })
      const result = pluginManifestToCardPluginProps(manifest)

      expect(result.brief).toEqual({ 'en-US': 'Plugin description' })
      expect(result.description).toEqual({ 'en-US': 'Plugin description' })
    })
  })

  describe('Tags Conversion', () => {
    it('should convert tags array to objects with name property', () => {
      const manifest = createMockPluginDeclaration({
        tags: ['search', 'image', 'api'],
      })
      const result = pluginManifestToCardPluginProps(manifest)

      expect(result.tags).toEqual([
        { name: 'search' },
        { name: 'image' },
        { name: 'api' },
      ])
    })

    it('should handle empty tags array', () => {
      const manifest = createMockPluginDeclaration({ tags: [] })
      const result = pluginManifestToCardPluginProps(manifest)

      expect(result.tags).toEqual([])
    })

    it('should handle single tag', () => {
      const manifest = createMockPluginDeclaration({ tags: ['single'] })
      const result = pluginManifestToCardPluginProps(manifest)

      expect(result.tags).toEqual([{ name: 'single' }])
    })
  })

  describe('Default Values', () => {
    it('should set latest_version to empty string', () => {
      const manifest = createMockPluginDeclaration()
      const result = pluginManifestToCardPluginProps(manifest)

      expect(result.latest_version).toBe('')
    })

    it('should set latest_package_identifier to empty string', () => {
      const manifest = createMockPluginDeclaration()
      const result = pluginManifestToCardPluginProps(manifest)

      expect(result.latest_package_identifier).toBe('')
    })

    it('should set introduction to empty string', () => {
      const manifest = createMockPluginDeclaration()
      const result = pluginManifestToCardPluginProps(manifest)

      expect(result.introduction).toBe('')
    })

    it('should set repository to empty string', () => {
      const manifest = createMockPluginDeclaration()
      const result = pluginManifestToCardPluginProps(manifest)

      expect(result.repository).toBe('')
    })

    it('should set install_count to 0', () => {
      const manifest = createMockPluginDeclaration()
      const result = pluginManifestToCardPluginProps(manifest)

      expect(result.install_count).toBe(0)
    })

    it('should set empty badges array', () => {
      const manifest = createMockPluginDeclaration()
      const result = pluginManifestToCardPluginProps(manifest)

      expect(result.badges).toEqual([])
    })

    it('should set verification with langgenius category', () => {
      const manifest = createMockPluginDeclaration()
      const result = pluginManifestToCardPluginProps(manifest)

      expect(result.verification).toEqual({ authorized_category: 'langgenius' })
    })

    it('should set from to package', () => {
      const manifest = createMockPluginDeclaration()
      const result = pluginManifestToCardPluginProps(manifest)

      expect(result.from).toBe('package')
    })
  })

  describe('Icon Handling', () => {
    it('should map icon correctly', () => {
      const manifest = createMockPluginDeclaration({ icon: '/custom-icon.png' })
      const result = pluginManifestToCardPluginProps(manifest)

      expect(result.icon).toBe('/custom-icon.png')
    })

    it('should map icon_dark when provided', () => {
      const manifest = createMockPluginDeclaration({
        icon: '/light-icon.png',
        icon_dark: '/dark-icon.png',
      })
      const result = pluginManifestToCardPluginProps(manifest)

      expect(result.icon).toBe('/light-icon.png')
      expect(result.icon_dark).toBe('/dark-icon.png')
    })
  })

  describe('Endpoint Settings', () => {
    it('should set endpoint with empty settings array', () => {
      const manifest = createMockPluginDeclaration()
      const result = pluginManifestToCardPluginProps(manifest)

      expect(result.endpoint).toEqual({ settings: [] })
    })
  })
})

describe('pluginManifestInMarketToPluginProps', () => {
  const createMockPluginManifestInMarket = (overrides?: Partial<PluginManifestInMarket>): PluginManifestInMarket => ({
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

  describe('Basic Conversion', () => {
    it('should convert plugin_unique_identifier to plugin_id', () => {
      const manifest = createMockPluginManifestInMarket()
      const result = pluginManifestInMarketToPluginProps(manifest)

      expect(result.plugin_id).toBe('market-plugin-123')
    })

    it('should convert category to type', () => {
      const manifest = createMockPluginManifestInMarket({ category: PluginCategoryEnum.model })
      const result = pluginManifestInMarketToPluginProps(manifest)

      expect(result.type).toBe(PluginCategoryEnum.model)
      expect(result.category).toBe(PluginCategoryEnum.model)
    })

    it('should use latest_version for version', () => {
      const manifest = createMockPluginManifestInMarket({
        version: '1.0.0',
        latest_version: '2.0.0',
      })
      const result = pluginManifestInMarketToPluginProps(manifest)

      expect(result.version).toBe('2.0.0')
      expect(result.latest_version).toBe('2.0.0')
    })

    it('should map org correctly', () => {
      const manifest = createMockPluginManifestInMarket({ org: 'my-organization' })
      const result = pluginManifestInMarketToPluginProps(manifest)

      expect(result.org).toBe('my-organization')
    })
  })

  describe('Brief and Description', () => {
    it('should map brief to both brief and description', () => {
      const manifest = createMockPluginManifestInMarket({
        brief: { 'en-US': 'Brief description' } as Record<string, string>,
      })
      const result = pluginManifestInMarketToPluginProps(manifest)

      expect(result.brief).toEqual({ 'en-US': 'Brief description' })
      expect(result.description).toEqual({ 'en-US': 'Brief description' })
    })
  })

  describe('Badges and Verification', () => {
    it('should map badges array', () => {
      const manifest = createMockPluginManifestInMarket({
        badges: ['partner', 'premium'],
      })
      const result = pluginManifestInMarketToPluginProps(manifest)

      expect(result.badges).toEqual(['partner', 'premium'])
    })

    it('should map verification when provided', () => {
      const manifest = createMockPluginManifestInMarket({
        verification: { authorized_category: 'partner' },
      })
      const result = pluginManifestInMarketToPluginProps(manifest)

      expect(result.verification).toEqual({ authorized_category: 'partner' })
    })

    it('should use default verification when empty', () => {
      const manifest = createMockPluginManifestInMarket({
        verification: {} as PluginManifestInMarket['verification'],
      })
      const result = pluginManifestInMarketToPluginProps(manifest)

      expect(result.verification).toEqual({ authorized_category: 'langgenius' })
    })
  })

  describe('Default Values', () => {
    it('should set verified to true', () => {
      const manifest = createMockPluginManifestInMarket()
      const result = pluginManifestInMarketToPluginProps(manifest)

      expect(result.verified).toBe(true)
    })

    it('should set latest_package_identifier to empty string', () => {
      const manifest = createMockPluginManifestInMarket()
      const result = pluginManifestInMarketToPluginProps(manifest)

      expect(result.latest_package_identifier).toBe('')
    })

    it('should set repository to empty string', () => {
      const manifest = createMockPluginManifestInMarket()
      const result = pluginManifestInMarketToPluginProps(manifest)

      expect(result.repository).toBe('')
    })

    it('should set install_count to 0', () => {
      const manifest = createMockPluginManifestInMarket()
      const result = pluginManifestInMarketToPluginProps(manifest)

      expect(result.install_count).toBe(0)
    })

    it('should set empty tags array', () => {
      const manifest = createMockPluginManifestInMarket()
      const result = pluginManifestInMarketToPluginProps(manifest)

      expect(result.tags).toEqual([])
    })

    it('should set endpoint with empty settings', () => {
      const manifest = createMockPluginManifestInMarket()
      const result = pluginManifestInMarketToPluginProps(manifest)

      expect(result.endpoint).toEqual({ settings: [] })
    })
  })

  describe('From Property', () => {
    it('should map from property correctly', () => {
      const manifest = createMockPluginManifestInMarket({ from: 'marketplace' })
      const result = pluginManifestInMarketToPluginProps(manifest)

      expect(result.from).toBe('marketplace')
    })

    it('should handle github from type', () => {
      const manifest = createMockPluginManifestInMarket({ from: 'github' })
      const result = pluginManifestInMarketToPluginProps(manifest)

      expect(result.from).toBe('github')
    })
  })
})

describe('parseGitHubUrl', () => {
  describe('Valid URLs', () => {
    it('should parse valid GitHub URL', () => {
      const result = parseGitHubUrl('https://github.com/owner/repo')

      expect(result.isValid).toBe(true)
      expect(result.owner).toBe('owner')
      expect(result.repo).toBe('repo')
    })

    it('should parse URL with trailing slash', () => {
      const result = parseGitHubUrl('https://github.com/owner/repo/')

      expect(result.isValid).toBe(true)
      expect(result.owner).toBe('owner')
      expect(result.repo).toBe('repo')
    })

    it('should handle hyphenated owner and repo names', () => {
      const result = parseGitHubUrl('https://github.com/my-org/my-repo')

      expect(result.isValid).toBe(true)
      expect(result.owner).toBe('my-org')
      expect(result.repo).toBe('my-repo')
    })

    it('should handle underscored names', () => {
      const result = parseGitHubUrl('https://github.com/my_org/my_repo')

      expect(result.isValid).toBe(true)
      expect(result.owner).toBe('my_org')
      expect(result.repo).toBe('my_repo')
    })

    it('should handle numeric characters in names', () => {
      const result = parseGitHubUrl('https://github.com/org123/repo456')

      expect(result.isValid).toBe(true)
      expect(result.owner).toBe('org123')
      expect(result.repo).toBe('repo456')
    })
  })

  describe('Invalid URLs', () => {
    it('should return invalid for non-GitHub URL', () => {
      const result = parseGitHubUrl('https://gitlab.com/owner/repo')

      expect(result.isValid).toBe(false)
      expect(result.owner).toBeUndefined()
      expect(result.repo).toBeUndefined()
    })

    it('should return invalid for URL with extra path segments', () => {
      const result = parseGitHubUrl('https://github.com/owner/repo/tree/main')

      expect(result.isValid).toBe(false)
    })

    it('should return invalid for URL without repo', () => {
      const result = parseGitHubUrl('https://github.com/owner')

      expect(result.isValid).toBe(false)
    })

    it('should return invalid for empty string', () => {
      const result = parseGitHubUrl('')

      expect(result.isValid).toBe(false)
    })

    it('should return invalid for malformed URL', () => {
      const result = parseGitHubUrl('not-a-url')

      expect(result.isValid).toBe(false)
    })

    it('should return invalid for http URL', () => {
      // Testing invalid http protocol - construct URL dynamically to avoid lint error
      const httpUrl = `${'http'}://github.com/owner/repo`
      const result = parseGitHubUrl(httpUrl)

      expect(result.isValid).toBe(false)
    })

    it('should return invalid for URL with www', () => {
      const result = parseGitHubUrl('https://www.github.com/owner/repo')

      expect(result.isValid).toBe(false)
    })
  })
})

describe('convertRepoToUrl', () => {
  describe('Valid Repos', () => {
    it('should convert repo to GitHub URL', () => {
      const result = convertRepoToUrl('owner/repo')

      expect(result).toBe('https://github.com/owner/repo')
    })

    it('should handle hyphenated names', () => {
      const result = convertRepoToUrl('my-org/my-repo')

      expect(result).toBe('https://github.com/my-org/my-repo')
    })

    it('should handle complex repo strings', () => {
      const result = convertRepoToUrl('organization_name/repository-name')

      expect(result).toBe('https://github.com/organization_name/repository-name')
    })
  })

  describe('Edge Cases', () => {
    it('should return empty string for empty repo', () => {
      const result = convertRepoToUrl('')

      expect(result).toBe('')
    })

    it('should return empty string for undefined-like values', () => {
      // TypeScript would normally prevent this, but testing runtime behavior
      const result = convertRepoToUrl(undefined as unknown as string)

      expect(result).toBe('')
    })

    it('should return empty string for null-like values', () => {
      const result = convertRepoToUrl(null as unknown as string)

      expect(result).toBe('')
    })

    it('should handle repo with special characters', () => {
      const result = convertRepoToUrl('org/repo.js')

      expect(result).toBe('https://github.com/org/repo.js')
    })
  })
})
