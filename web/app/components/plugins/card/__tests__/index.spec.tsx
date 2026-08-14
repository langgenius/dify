import type { CardPayload } from '../index'
import { render } from '@testing-library/react'
import { useAtomValue } from 'jotai'
import { describe, expect, it, vi } from 'vitest'
import { MARKETPLACE_API_PREFIX } from '@/config'
import { PluginCategoryEnum } from '../../types'
import Card from '../index'

vi.mock('jotai', () => ({
  useAtomValue: vi.fn(),
}))

vi.mock('@/context/workspace-state', () => ({
  currentWorkspaceIdAtom: Symbol('currentWorkspaceIdAtom'),
}))

vi.mock('#i18n', () => ({
  useTranslation: () => ({
    t: (key: string | ((...args: never[]) => unknown)) =>
      typeof key === 'string' ? key : 'translated',
  }),
}))

vi.mock('@/context/i18n', () => ({
  useGetLanguage: () => 'en-US',
}))

vi.mock('@/hooks/use-theme', () => ({
  default: () => ({ theme: 'light' }),
}))

vi.mock('@/i18n-config', () => ({
  renderI18nObject: (value: Record<string, string>) => value['en-US'] ?? '',
}))

vi.mock('../../hooks', () => ({
  useCategories: () => ({
    categoriesMap: {
      tool: { label: 'Tool' },
    },
  }),
}))

const marketplacePlugin = {
  badges: [],
  brief: { 'en-US': 'Marketplace plugin description' },
  category: PluginCategoryEnum.tool,
  description: { 'en-US': 'Marketplace plugin description' },
  endpoint: { settings: [] },
  from: 'marketplace',
  icon: 'icon.png',
  install_count: 0,
  introduction: '',
  label: { 'en-US': 'Marketplace plugin' },
  latest_package_identifier: 'langgenius/demo-plugin:1.0.0',
  latest_version: '1.0.0',
  name: 'demo-plugin',
  org: 'langgenius',
  plugin_id: 'langgenius/demo-plugin',
  repository: '',
  tags: [],
  type: 'plugin',
  verified: false,
  verification: { authorized_category: 'langgenius' },
  version: '1.0.0',
} satisfies CardPayload

describe('Plugin card workspace boundary', () => {
  it('renders Marketplace variant icons without reading Dify workspace state', () => {
    vi.mocked(useAtomValue).mockImplementation(() => {
      throw new Error('Dify workspace state must not be read')
    })

    const payloadWithoutSource = {
      ...marketplacePlugin,
      from: undefined,
    } as unknown as CardPayload
    const { container } = render(<Card payload={payloadWithoutSource} variant="marketplace" />)

    expect(container.querySelector('[style*="background-image"]')).toHaveStyle({
      backgroundImage: `url("${MARKETPLACE_API_PREFIX}/plugins/langgenius/demo-plugin/icon")`,
    })
    expect(useAtomValue).not.toHaveBeenCalled()
  })
})
