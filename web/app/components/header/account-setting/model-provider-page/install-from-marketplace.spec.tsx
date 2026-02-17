import type { Mock } from 'vitest'
import type { ModelProvider } from './declarations'
import { fireEvent, render, screen } from '@testing-library/react'

import { describe, expect, it, vi } from 'vitest'
import { useMarketplaceAllPlugins } from './hooks'
import InstallFromMarketplace from './install-from-marketplace'

// Mock dependencies
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode, href: string }) => <a href={href}>{children}</a>,
}))

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light' }),
}))

vi.mock('@/app/components/base/divider', () => ({
  default: () => <div data-testid="divider" />,
}))

vi.mock('@/app/components/base/loading', () => ({
  default: () => <div data-testid="loading" />,
}))

vi.mock('@/app/components/plugins/marketplace/list', () => ({
  default: ({ plugins }: { plugins: { plugin_id: string, name: string }[] }) => (
    <div data-testid="plugin-list">
      {plugins.map(p => (
        <div key={p.plugin_id} data-testid="plugin-item">
          {p.name}
        </div>
      ))}
    </div>
  ),
}))

vi.mock('@/app/components/plugins/provider-card', () => ({
  default: () => <div data-testid="provider-card" />,
}))

vi.mock('./hooks', () => ({
  useMarketplaceAllPlugins: vi.fn(() => ({
    plugins: [],
    isLoading: false,
  })),
}))

describe('InstallFromMarketplace', () => {
  const mockProviders = [] as ModelProvider[]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render expanded by default', () => {
    render(<InstallFromMarketplace providers={mockProviders} searchText="" />)
    expect(screen.getByText('common.modelProvider.installProvider')).toBeInTheDocument()
    expect(screen.getByTestId('plugin-list')).toBeInTheDocument()
  })

  it('should collapse when clicked', () => {
    render(<InstallFromMarketplace providers={mockProviders} searchText="" />)
    fireEvent.click(screen.getByText('common.modelProvider.installProvider'))
    expect(screen.queryByTestId('plugin-list')).not.toBeInTheDocument()
  })

  it('should show loading state', () => {
    (useMarketplaceAllPlugins as unknown as Mock).mockReturnValue({
      plugins: [],
      isLoading: true,
    })

    render(<InstallFromMarketplace providers={mockProviders} searchText="" />)
    // It's expanded by default, so loading should show immediately
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('should list plugins', () => {
    (useMarketplaceAllPlugins as unknown as Mock).mockReturnValue({
      plugins: [{ plugin_id: '1', name: 'Plugin 1' }],
      isLoading: false,
    })

    render(<InstallFromMarketplace providers={mockProviders} searchText="" />)
    // Expanded by default
    expect(screen.getByText('Plugin 1')).toBeInTheDocument()
  })

  it('should render discovery link', () => {
    render(<InstallFromMarketplace providers={mockProviders} searchText="" />)
    expect(screen.getByText('plugin.marketplace.difyMarketplace')).toHaveAttribute('href')
  })
})
