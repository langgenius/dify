import type { Plugin } from '@/app/components/plugins/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import CardWrapper from '../card-wrapper'

vi.mock('#i18n', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { ns?: string }) => options?.ns ? `${options.ns}.${key}` : key,
  }),
  useLocale: () => 'en-US',
}))

vi.mock('next-themes', () => ({
  useTheme: () => ({
    theme: 'dark',
  }),
}))

vi.mock('ahooks', async () => {
  const React = await import('react')
  return {
    useBoolean: (initialValue: boolean) => {
      const [value, setValue] = React.useState(initialValue)
      return [
        value,
        {
          setTrue: () => setValue(true),
          setFalse: () => setValue(false),
          toggle: () => setValue(current => !current),
        },
      ] as const
    },
  }
})

vi.mock('@/app/components/plugins/hooks', () => ({
  useTags: () => ({
    getTagLabel: (name: string) => `tag:${name}`,
  }),
}))

vi.mock('@/app/components/plugins/card', () => ({
  default: ({ payload, footer }: { payload: Plugin, footer?: React.ReactNode }) => (
    <div data-testid="card">
      <span>{payload.name}</span>
      {footer}
    </div>
  ),
}))

vi.mock('@/app/components/plugins/card/card-more-info', () => ({
  default: ({ downloadCount, tags }: { downloadCount: number, tags: string[] }) => (
    <div data-testid="card-more-info">
      {downloadCount}
      :
      {tags.join('|')}
    </div>
  ),
}))

vi.mock('@/app/components/plugins/install-plugin/install-from-marketplace', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="install-modal">
      <button data-testid="close-install-modal" onClick={onClose}>close</button>
    </div>
  ),
}))

vi.mock('@/app/components/base/button', () => ({
  default: ({ children, onClick }: { children: React.ReactNode, onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
}))

vi.mock('../../utils', () => ({
  getPluginDetailLinkInMarketplace: (plugin: Plugin) => `/detail/${plugin.org}/${plugin.name}`,
  getPluginLinkInMarketplace: (plugin: Plugin, params: Record<string, string>) => `/marketplace/${plugin.org}/${plugin.name}?language=${params.language}&theme=${params.theme}`,
}))

const plugin = {
  type: 'plugin',
  org: 'dify',
  name: 'plugin-a',
  plugin_id: 'plugin-a',
  version: '1.0.0',
  latest_version: '1.0.0',
  latest_package_identifier: 'pkg',
  icon: 'icon.png',
  verified: true,
  label: { 'en-US': 'Plugin A' },
  brief: { 'en-US': 'Brief' },
  description: { 'en-US': 'Description' },
  introduction: 'Intro',
  repository: 'https://github.com/dify/plugin-a',
  category: PluginCategoryEnum.tool,
  install_count: 42,
  endpoint: { settings: [] },
  tags: [{ name: 'search' }, { name: 'agent' }],
  badges: [],
  verification: { authorized_category: 'community' },
  from: 'marketplace',
} as Plugin

describe('CardWrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders plugin detail link when install button is hidden', () => {
    render(<CardWrapper plugin={plugin} />)

    expect(screen.getByRole('link')).toHaveAttribute('href', '/detail/dify/plugin-a')
    expect(screen.getByTestId('card-more-info')).toHaveTextContent('42:tag:search|tag:agent')
  })

  it('renders install and marketplace detail actions when install button is shown', () => {
    render(<CardWrapper plugin={plugin} showInstallButton />)

    expect(screen.getByRole('button', { name: 'plugin.detailPanel.operation.install' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'plugin.detailPanel.operation.detail' })).toHaveAttribute(
      'href',
      '/marketplace/dify/plugin-a?language=en-US&theme=dark',
    )
  })

  it('opens and closes install modal from install action', () => {
    render(<CardWrapper plugin={plugin} showInstallButton />)

    fireEvent.click(screen.getByRole('button', { name: 'plugin.detailPanel.operation.install' }))
    expect(screen.getByTestId('install-modal')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('close-install-modal'))
    expect(screen.queryByTestId('install-modal')).not.toBeInTheDocument()
  })
})
