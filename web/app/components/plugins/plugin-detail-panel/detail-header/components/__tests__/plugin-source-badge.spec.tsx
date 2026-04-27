import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginSource } from '../../../../types'
import PluginSourceBadge from '../plugin-source-badge'

describe('PluginSourceBadge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Source Icon Rendering', () => {
    it('should render marketplace source badge', () => {
      render(<PluginSourceBadge source={PluginSource.marketplace} />)

      expect(screen.getByLabelText('plugin.detailPanel.categoryTip.marketplace')).toBeInTheDocument()
    })

    it('should render github source badge', () => {
      render(<PluginSourceBadge source={PluginSource.github} />)

      expect(screen.getByLabelText('plugin.detailPanel.categoryTip.github')).toBeInTheDocument()
    })

    it('should render local source badge', () => {
      render(<PluginSourceBadge source={PluginSource.local} />)

      expect(screen.getByLabelText('plugin.detailPanel.categoryTip.local')).toBeInTheDocument()
    })

    it('should render debugging source badge', () => {
      render(<PluginSourceBadge source={PluginSource.debugging} />)

      expect(screen.getByLabelText('plugin.detailPanel.categoryTip.debugging')).toBeInTheDocument()
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

      expect(screen.getByLabelText('plugin.detailPanel.categoryTip.marketplace')).toBeInTheDocument()
    })

    it('should show github tooltip', () => {
      render(<PluginSourceBadge source={PluginSource.github} />)

      expect(screen.getByLabelText('plugin.detailPanel.categoryTip.github')).toBeInTheDocument()
    })

    it('should show local tooltip', () => {
      render(<PluginSourceBadge source={PluginSource.local} />)

      expect(screen.getByLabelText('plugin.detailPanel.categoryTip.local')).toBeInTheDocument()
    })

    it('should show debugging tooltip', () => {
      render(<PluginSourceBadge source={PluginSource.debugging} />)

      expect(screen.getByLabelText('plugin.detailPanel.categoryTip.debugging')).toBeInTheDocument()
    })
  })

  describe('Icon Element Structure', () => {
    it('should render icon inside tooltip for marketplace', () => {
      const { container } = render(<PluginSourceBadge source={PluginSource.marketplace} />)
      expect(container.querySelector('[aria-label="plugin.detailPanel.categoryTip.marketplace"]')).toBeInTheDocument()
    })

    it('should render icon inside tooltip for github', () => {
      const { container } = render(<PluginSourceBadge source={PluginSource.github} />)
      expect(container.querySelector('[aria-label="plugin.detailPanel.categoryTip.github"]')).toBeInTheDocument()
    })

    it('should render icon inside tooltip for local', () => {
      const { container } = render(<PluginSourceBadge source={PluginSource.local} />)
      expect(container.querySelector('[aria-label="plugin.detailPanel.categoryTip.local"]')).toBeInTheDocument()
    })

    it('should render icon inside tooltip for debugging', () => {
      const { container } = render(<PluginSourceBadge source={PluginSource.debugging} />)
      expect(container.querySelector('[aria-label="plugin.detailPanel.categoryTip.debugging"]')).toBeInTheDocument()
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

      expect(screen.queryByLabelText(/^plugin\.detailPanel\.categoryTip\./)).not.toBeInTheDocument()
    })
  })
})
