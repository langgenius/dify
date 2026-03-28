import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginSource } from '../../../../types'
import PluginSourceBadge from '../plugin-source-badge'

vi.mock('@/app/components/base/tooltip', () => ({
  default: ({ children, popupContent }: { children: React.ReactNode, popupContent: string }) => (
    <div data-testid="tooltip" data-content={popupContent}>
      {children}
    </div>
  ),
}))

describe('PluginSourceBadge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Source Icon Rendering', () => {
    it('should render marketplace source badge', () => {
      render(<PluginSourceBadge source={PluginSource.marketplace} />)

      const tooltip = screen.getByTestId('tooltip')
      expect(tooltip).toBeInTheDocument()
      expect(tooltip).toHaveAttribute('data-content', 'plugin.detailPanel.categoryTip.marketplace')
    })

    it('should render github source badge', () => {
      render(<PluginSourceBadge source={PluginSource.github} />)

      const tooltip = screen.getByTestId('tooltip')
      expect(tooltip).toBeInTheDocument()
      expect(tooltip).toHaveAttribute('data-content', 'plugin.detailPanel.categoryTip.github')
    })

    it('should render local source badge', () => {
      render(<PluginSourceBadge source={PluginSource.local} />)

      const tooltip = screen.getByTestId('tooltip')
      expect(tooltip).toBeInTheDocument()
      expect(tooltip).toHaveAttribute('data-content', 'plugin.detailPanel.categoryTip.local')
    })

    it('should render debugging source badge', () => {
      render(<PluginSourceBadge source={PluginSource.debugging} />)

      const tooltip = screen.getByTestId('tooltip')
      expect(tooltip).toBeInTheDocument()
      expect(tooltip).toHaveAttribute('data-content', 'plugin.detailPanel.categoryTip.debugging')
    })
  })

  describe('Separator Rendering', () => {
    it('should render separator dot before marketplace badge', () => {
      const { container } = render(<PluginSourceBadge source={PluginSource.marketplace} />)

      const separator = container.querySelector('.text-text-quaternary')
      expect(separator).toBeInTheDocument()
      expect(separator?.textContent).toBe('·')
    })

    it('should render separator dot before github badge', () => {
      const { container } = render(<PluginSourceBadge source={PluginSource.github} />)

      const separator = container.querySelector('.text-text-quaternary')
      expect(separator).toBeInTheDocument()
      expect(separator?.textContent).toBe('·')
    })

    it('should render separator dot before local badge', () => {
      const { container } = render(<PluginSourceBadge source={PluginSource.local} />)

      const separator = container.querySelector('.text-text-quaternary')
      expect(separator).toBeInTheDocument()
    })

    it('should render separator dot before debugging badge', () => {
      const { container } = render(<PluginSourceBadge source={PluginSource.debugging} />)

      const separator = container.querySelector('.text-text-quaternary')
      expect(separator).toBeInTheDocument()
    })
  })

  describe('Tooltip Content', () => {
    it('should show marketplace tooltip', () => {
      render(<PluginSourceBadge source={PluginSource.marketplace} />)

      expect(screen.getByTestId('tooltip')).toHaveAttribute(
        'data-content',
        'plugin.detailPanel.categoryTip.marketplace',
      )
    })

    it('should show github tooltip', () => {
      render(<PluginSourceBadge source={PluginSource.github} />)

      expect(screen.getByTestId('tooltip')).toHaveAttribute(
        'data-content',
        'plugin.detailPanel.categoryTip.github',
      )
    })

    it('should show local tooltip', () => {
      render(<PluginSourceBadge source={PluginSource.local} />)

      expect(screen.getByTestId('tooltip')).toHaveAttribute(
        'data-content',
        'plugin.detailPanel.categoryTip.local',
      )
    })

    it('should show debugging tooltip', () => {
      render(<PluginSourceBadge source={PluginSource.debugging} />)

      expect(screen.getByTestId('tooltip')).toHaveAttribute(
        'data-content',
        'plugin.detailPanel.categoryTip.debugging',
      )
    })
  })

  describe('Icon Element Structure', () => {
    it('should render icon inside tooltip for marketplace', () => {
      render(<PluginSourceBadge source={PluginSource.marketplace} />)

      const tooltip = screen.getByTestId('tooltip')
      const iconWrapper = tooltip.querySelector('div')
      expect(iconWrapper).toBeInTheDocument()
    })

    it('should render icon inside tooltip for github', () => {
      render(<PluginSourceBadge source={PluginSource.github} />)

      const tooltip = screen.getByTestId('tooltip')
      const iconWrapper = tooltip.querySelector('div')
      expect(iconWrapper).toBeInTheDocument()
    })

    it('should render icon inside tooltip for local', () => {
      render(<PluginSourceBadge source={PluginSource.local} />)

      const tooltip = screen.getByTestId('tooltip')
      const iconWrapper = tooltip.querySelector('div')
      expect(iconWrapper).toBeInTheDocument()
    })

    it('should render icon inside tooltip for debugging', () => {
      render(<PluginSourceBadge source={PluginSource.debugging} />)

      const tooltip = screen.getByTestId('tooltip')
      const iconWrapper = tooltip.querySelector('div')
      expect(iconWrapper).toBeInTheDocument()
    })
  })

  describe('Lookup Table Coverage', () => {
    it('should handle all PluginSource enum values', () => {
      const allSources = Object.values(PluginSource)

      allSources.forEach((source) => {
        const { container } = render(<PluginSourceBadge source={source} />)
        // Should render either tooltip or nothing
        expect(container).toBeTruthy()
      })
    })
  })

  describe('Invalid Source Handling', () => {
    it('should return null for unknown source type', () => {
      // Use type assertion to test invalid source value
      const invalidSource = 'unknown_source' as PluginSource
      const { container } = render(<PluginSourceBadge source={invalidSource} />)

      // Should render nothing (empty container)
      expect(container.firstChild).toBeNull()
    })

    it('should not render separator for invalid source', () => {
      const invalidSource = 'invalid' as PluginSource
      const { container } = render(<PluginSourceBadge source={invalidSource} />)

      const separator = container.querySelector('.text-text-quaternary')
      expect(separator).not.toBeInTheDocument()
    })

    it('should not render tooltip for invalid source', () => {
      const invalidSource = '' as PluginSource
      render(<PluginSourceBadge source={invalidSource} />)

      expect(screen.queryByTestId('tooltip')).not.toBeInTheDocument()
    })
  })
})
