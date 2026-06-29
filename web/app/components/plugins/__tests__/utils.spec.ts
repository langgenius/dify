import type { Plugin } from '../types'
import { describe, expect, it } from 'vitest'
import { API_PREFIX, MARKETPLACE_API_PREFIX } from '@/config'
import { getPluginCardIconUrl } from '../utils'

const createPlugin = (overrides: Partial<Pick<Plugin, 'from' | 'name' | 'org' | 'type'>> = {}): Pick<Plugin, 'from' | 'name' | 'org' | 'type'> => ({
  from: 'github',
  name: 'demo-plugin',
  org: 'langgenius',
  type: 'plugin',
  ...overrides,
})

describe('plugins/utils', () => {
  describe('getPluginCardIconUrl', () => {
    it('returns an empty string when icon is missing', () => {
      expect(getPluginCardIconUrl(createPlugin(), undefined, 'tenant-1')).toBe('')
    })

    it('returns absolute urls and root-relative urls as-is', () => {
      expect(getPluginCardIconUrl(createPlugin(), 'https://example.com/icon.png', 'tenant-1')).toBe('https://example.com/icon.png')
      expect(getPluginCardIconUrl(createPlugin(), '/icons/demo.png', 'tenant-1')).toBe('/icons/demo.png')
    })

    it('builds the marketplace icon url for plugins and bundles', () => {
      expect(getPluginCardIconUrl(createPlugin({ from: 'marketplace' }), 'icon.png', 'tenant-1'))
        .toBe(`${MARKETPLACE_API_PREFIX}/plugins/langgenius/demo-plugin/icon`)
      expect(getPluginCardIconUrl(createPlugin({ from: 'marketplace', type: 'bundle' }), 'icon.png', 'tenant-1'))
        .toBe(`${MARKETPLACE_API_PREFIX}/bundles/langgenius/demo-plugin/icon`)
    })

    it('falls back to the raw icon when tenant id is missing for non-marketplace plugins', () => {
      expect(getPluginCardIconUrl(createPlugin(), 'icon.png', '')).toBe('icon.png')
    })

    it('builds the workspace icon url for tenant-scoped plugins', () => {
      expect(getPluginCardIconUrl(createPlugin(), 'icon.png', 'tenant-1'))
        .toBe(`${API_PREFIX}/workspaces/current/plugin/icon?tenant_id=tenant-1&filename=icon.png`)
    })
  })
})
