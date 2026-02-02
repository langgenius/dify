import type { Mock } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useSelectedLayoutSegment } from 'next/navigation'
import { usePluginTaskStatus } from '@/app/components/plugins/plugin-page/plugin-tasks/hooks'

import PluginsNav from './index'

// Mock dependencies
vi.mock('next/navigation', () => ({
  useSelectedLayoutSegment: vi.fn(),
}))

vi.mock('@/app/components/plugins/plugin-page/plugin-tasks/hooks', () => ({
  usePluginTaskStatus: vi.fn(),
}))

// Use real components for Indicator, DownloadingIcon, Group
// No mocks for them.

describe('PluginsNav', () => {
  const mockUseSelectedLayoutSegment = useSelectedLayoutSegment as Mock
  const mockUsePluginTaskStatus = usePluginTaskStatus as Mock

  beforeEach(() => {
    vi.clearAllMocks()

    // Default mock setup: Not active, no installing/error tasks
    mockUseSelectedLayoutSegment.mockReturnValue(null)
    mockUsePluginTaskStatus.mockReturnValue({
      isInstalling: false,
      isInstallingWithError: false,
      isFailed: false,
    })
  })

  it('renders correctly (Default)', () => {
    render(<PluginsNav />)

    // Check Link href
    const linkElement = screen.getByRole('link')
    expect(linkElement).toHaveAttribute('href', '/plugins')
    expect(screen.getByText('common.menus.plugins')).toBeInTheDocument()

    // Should show Group icon (default)
    // Group icon is rendered via IconBase. We can check if an SVG is present.
    // Since there are no other icons in default state, 1 SVG should be present.
    // The DownloadingIcon has class "install-icon", Group icon does not.
    const svg = linkElement.querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(svg).not.toHaveClass('install-icon') // It is NOT the downloading icon

    // Indicator should NOT be present
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

      // Should show DownloadingIcon
      const downloadingIcon = container.querySelector('.install-icon')
      expect(downloadingIcon).toBeInTheDocument()

      // Should NOT show Group icon (PluginsNav hides Group when installing)
      // Implementation: (!(isInstalling || isInstallingWithError) || activated) -> False
      // So Group icon is not rendered.
      // But DownloadingIcon is an SVG with class install-icon.
      // So querying 'svg' might find it.
      // We want to ensure NO OTHER svg is there.
      const svgs = container.querySelectorAll('svg')
      expect(svgs.length).toBe(1)
      expect(svgs[0]).toHaveClass('install-icon')

      // Indicator should NOT be present
      expect(screen.queryByTestId('status-indicator')).not.toBeInTheDocument()
    })

    it('renders Installing With Error state (Inactive)', () => {
      mockUsePluginTaskStatus.mockReturnValue({ isInstallingWithError: true })

      const { container } = render(<PluginsNav />)

      // Should show DownloadingIcon
      const downloadingIcon = container.querySelector('.install-icon')
      expect(downloadingIcon).toBeInTheDocument()

      // Should show Indicator
      expect(screen.getByTestId('status-indicator')).toBeInTheDocument()
    })

    it('renders Failed state (Inactive)', () => {
      mockUsePluginTaskStatus.mockReturnValue({ isFailed: true })

      const { container } = render(<PluginsNav />)

      // Should show Group icon (Implementation: (!(isInstalling || isInstallingWithError) || activated) -> True)
      // Because isFailed is True, but IsInstalling is False.
      // Wait, let's re-read code:
      // (!(isInstalling || isInstallingWithError) || activated)
      // If isFailed=true, isInstalling=false, isInstallingWithError=false.
      // ! (false || false) -> true.
      // So Group icon IS SHOWN.

      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
      expect(svg).not.toHaveClass('install-icon')

      // Should show Indicator
      // (isFailed || isInstallingWithError) && !activated -> true
      expect(screen.getByTestId('status-indicator')).toBeInTheDocument()
    })

    it('renders Default icon when Active even if installing', () => {
      mockUseSelectedLayoutSegment.mockReturnValue('plugins')
      mockUsePluginTaskStatus.mockReturnValue({ isInstalling: true })

      const { container } = render(<PluginsNav />)

      // Activated -> Group icon shown
      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
      expect(svg).not.toHaveClass('install-icon')

      // DownloadingIcon hidden
      expect(container.querySelector('.install-icon')).not.toBeInTheDocument()
    })
  })
})
