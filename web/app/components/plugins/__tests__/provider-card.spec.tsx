import type { Plugin } from '../types'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ProviderCard from '../provider-card'
import { PluginCategoryEnum } from '../types'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { ns?: string }) => options?.ns ? `${options.ns}.${key}` : key,
  }),
}))

vi.mock('next-themes', () => ({
  useTheme: () => ({
    theme: 'light',
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
        },
      ] as const
    },
  }
})

vi.mock('@/context/i18n', () => ({
  useLocale: () => 'en-US',
}))

vi.mock('@/hooks/use-i18n', () => ({
  useRenderI18nObject: () => (value: Record<string, string>) => value['en-US'] || value.en_US,
}))

vi.mock('@/app/components/base/button', () => ({
  default: ({
    children,
    onClick,
  }: {
    children: React.ReactNode
    onClick?: () => void
  }) => <button onClick={onClick}>{children}</button>,
}))

vi.mock('@/app/components/plugins/install-plugin/install-from-marketplace', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="install-modal">
      <button data-testid="close-install-modal" onClick={onClose}>close</button>
    </div>
  ),
}))

vi.mock('@/app/components/plugins/marketplace/utils', () => ({
  getPluginLinkInMarketplace: (plugin: Plugin, params: Record<string, string>) =>
    `/marketplace/${plugin.org}/${plugin.name}?language=${params.language}&theme=${params.theme}`,
}))

vi.mock('@/app/components/base/badge', () => ({
  default: ({ text }: { text: string }) => <span data-testid="tag-badge">{text}</span>,
}))

vi.mock('../card/base/card-icon', () => ({
  default: ({ src }: { src: string }) => <div data-testid="provider-icon">{src}</div>,
}))

vi.mock('../card/base/description', () => ({
  default: ({ text }: { text: string }) => <div data-testid="description">{text}</div>,
}))

vi.mock('../card/base/download-count', () => ({
  default: ({ downloadCount }: { downloadCount: number }) => <div data-testid="download-count">{downloadCount}</div>,
}))

vi.mock('../card/base/title', () => ({
  default: ({ title }: { title: string }) => <div data-testid="title">{title}</div>,
}))

const payload = {
  type: 'plugin',
  org: 'dify',
  name: 'provider-one',
  plugin_id: 'provider-one',
  version: '1.0.0',
  latest_version: '1.0.0',
  latest_package_identifier: 'pkg-1',
  icon: 'icon.png',
  verified: true,
  label: { 'en-US': 'Provider One' },
  brief: { 'en-US': 'Provider description' },
  description: { 'en-US': 'Full description' },
  introduction: 'Intro',
  repository: 'https://github.com/dify/provider-one',
  category: PluginCategoryEnum.tool,
  install_count: 123,
  endpoint: { settings: [] },
  tags: [{ name: 'search' }, { name: 'rag' }],
  badges: [],
  verification: { authorized_category: 'community' },
  from: 'marketplace',
} as Plugin

describe('ProviderCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders provider information, tags, and detail link', () => {
    render(<ProviderCard payload={payload} />)

    expect(screen.getByTestId('title')).toHaveTextContent('Provider One')
    expect(screen.getByText('dify')).toBeInTheDocument()
    expect(screen.getByTestId('download-count')).toHaveTextContent('123')
    expect(screen.getByTestId('description')).toHaveTextContent('Provider description')
    expect(screen.getAllByTestId('tag-badge')).toHaveLength(2)
    expect(screen.getByRole('link', { name: /plugin.detailPanel.operation.detail/i })).toHaveAttribute(
      'href',
      '/marketplace/dify/provider-one?language=en-US&theme=light',
    )
  })

  it('opens and closes the install modal', () => {
    render(<ProviderCard payload={payload} />)

    fireEvent.click(screen.getByRole('button', { name: /plugin.detailPanel.operation.install/i }))
    expect(screen.getByTestId('install-modal')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('close-install-modal'))
    expect(screen.queryByTestId('install-modal')).not.toBeInTheDocument()
  })
})
