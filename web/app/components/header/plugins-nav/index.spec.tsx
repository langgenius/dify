import type { Mock } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useSelectedLayoutSegment } from 'next/navigation'
import { usePluginTaskStatus } from '@/app/components/plugins/plugin-page/plugin-tasks/hooks'

import PluginsNav from './index'

vi.mock('next/navigation', () => ({
  useSelectedLayoutSegment: vi.fn(),
}))

vi.mock('@/app/components/plugins/plugin-page/plugin-tasks/hooks', () => ({
  usePluginTaskStatus: vi.fn(),
}))

describe('PluginsNav', () => {
  const mockUseSelectedLayoutSegment = useSelectedLayoutSegment as Mock
  const mockUsePluginTaskStatus = usePluginTaskStatus as Mock

  beforeEach(() => {
    vi.clearAllMocks()

    mockUseSelectedLayoutSegment.mockReturnValue(null)
    mockUsePluginTaskStatus.mockReturnValue({
      isInstalling: false,
      isInstallingWithError: false,
      isFailed: false,
    })
  })

  it('renders correctly (Default)', () => {
    render(<PluginsNav />)

    const linkElement = screen.getByRole('link')
    expect(linkElement).toHaveAttribute('href', '/plugins')
    expect(screen.getByText('common.menus.plugins')).toBeInTheDocument()

    const svg = linkElement.querySelector('svg')
    expect(svg).toBeInTheDocument()

    expect(screen.queryByTestId('status-indicator')).not.toBeInTheDocument()
  })

  describe('Active State', () => {
    it('should have active styling when segment is "plugins"', () => {
      mockUseSelectedLayoutSegment.mockReturnValue('plugins')

      render(<PluginsNav />)

      const container = screen.getByText('common.menus.plugins').closest('div')
      expect(container).toHaveClass(
        'border-components-main-nav-nav-button-border',
      )
      expect(container).toHaveClass(
        'bg-components-main-nav-nav-button-bg-active',
      )
    })
  })

  describe('Task Status Indicators', () => {
    it('renders Installing state (Inactive)', () => {
      mockUsePluginTaskStatus.mockReturnValue({ isInstalling: true })

      const { container } = render(<PluginsNav />)

      const downloadingIcon = container.querySelector('.install-icon')
      expect(downloadingIcon).toBeInTheDocument()

      const svgs = container.querySelectorAll('svg')
      expect(svgs.length).toBe(1)
      expect(svgs[0]).toHaveClass('install-icon')

      expect(screen.queryByTestId('status-indicator')).not.toBeInTheDocument()
    })

    it('renders Installing With Error state (Inactive)', () => {
      mockUsePluginTaskStatus.mockReturnValue({ isInstallingWithError: true })

      const { container } = render(<PluginsNav />)

      const downloadingIcon = container.querySelector('.install-icon')
      expect(downloadingIcon).toBeInTheDocument()

      expect(screen.getByTestId('status-indicator')).toBeInTheDocument()
    })

    it('renders Failed state (Inactive)', () => {
      mockUsePluginTaskStatus.mockReturnValue({ isFailed: true })

      const { container } = render(<PluginsNav />)

      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
      expect(svg).not.toHaveClass('install-icon')

      expect(screen.getByTestId('status-indicator')).toBeInTheDocument()
    })

    it('renders Default icon when Active even if installing', () => {
      mockUseSelectedLayoutSegment.mockReturnValue('plugins')
      mockUsePluginTaskStatus.mockReturnValue({ isInstalling: true })

      const { container } = render(<PluginsNav />)

      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
      expect(svg).not.toHaveClass('install-icon')

      expect(container.querySelector('.install-icon')).not.toBeInTheDocument()
    })
  })
})
