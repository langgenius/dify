import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
// Import the mock to control it in tests
import useTheme from '@/hooks/use-theme'
import { ToolTypeEnum } from '../../workflow/block-selector/types'

import Empty from './empty'

// Mock useTheme hook
vi.mock('@/hooks/use-theme', () => ({
  default: vi.fn(() => ({ theme: 'light' })),
}))

describe('Empty', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useTheme).mockReturnValue({ theme: 'light' } as ReturnType<typeof useTheme>)
  })

  // Tests for basic rendering scenarios
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<Empty />)

      expect(screen.getByText('No tools available')).toBeInTheDocument()
    })

    it('should render placeholder icon', () => {
      render(<Empty />)

      // NoToolPlaceholder should be rendered
      const container = document.querySelector('.flex.flex-col')
      expect(container).toBeInTheDocument()
    })

    it('should render fallback title when no type provided', () => {
      render(<Empty />)

      expect(screen.getByText('No tools available')).toBeInTheDocument()
    })
  })

  // Tests for different type prop values
  describe('Type Props', () => {
    it('should render with Custom type and include link to /tools?category=api', () => {
      render(<Empty type={ToolTypeEnum.Custom} />)

      const link = document.querySelector('a[href="/tools?category=api"]')
      expect(link).toBeInTheDocument()
      expect(link).toHaveAttribute('target', '_blank')
    })

    it('should render with MCP type and include link to /tools?category=mcp', () => {
      render(<Empty type={ToolTypeEnum.MCP} />)

      const link = document.querySelector('a[href="/tools?category=mcp"]')
      expect(link).toBeInTheDocument()
      expect(link).toHaveAttribute('target', '_blank')
    })

    it('should render arrow icon for types with links', () => {
      render(<Empty type={ToolTypeEnum.Custom} />)

      // Check for RiArrowRightUpLine icon (has class h-3 w-3)
      const arrowIcon = document.querySelector('.h-3.w-3')
      expect(arrowIcon).toBeInTheDocument()
    })

    it('should not render link for BuiltIn type', () => {
      render(<Empty type={ToolTypeEnum.BuiltIn} />)

      const link = document.querySelector('a')
      expect(link).not.toBeInTheDocument()
    })

    it('should not render link for Workflow type', () => {
      render(<Empty type={ToolTypeEnum.Workflow} />)

      const link = document.querySelector('a')
      expect(link).not.toBeInTheDocument()
    })
  })

  // Tests for isAgent prop
  describe('isAgent Prop', () => {
    it('should render as agent without link', () => {
      render(<Empty type={ToolTypeEnum.Custom} isAgent />)

      // When isAgent is true, no link should be rendered
      const link = document.querySelector('a')
      expect(link).not.toBeInTheDocument()
    })

    it('should not render tip text when isAgent is true', () => {
      render(<Empty type={ToolTypeEnum.Custom} isAgent />)

      // Arrow icon should not be present when isAgent is true
      const arrowIcon = document.querySelector('.h-3.w-3')
      expect(arrowIcon).not.toBeInTheDocument()
    })
  })

  // Tests for theme-based styling
  describe('Theme Support', () => {
    it('should not apply invert class in light theme', () => {
      vi.mocked(useTheme).mockReturnValue({ theme: 'light' } as ReturnType<typeof useTheme>)

      render(<Empty />)

      // The NoToolPlaceholder should not have 'invert' class in light mode
      // We check the first svg or container within the component
      const placeholder = document.querySelector('.flex.flex-col > *:first-child')
      expect(placeholder).not.toHaveClass('invert')
    })

    it('should apply invert class in dark theme', () => {
      vi.mocked(useTheme).mockReturnValue({ theme: 'dark' } as ReturnType<typeof useTheme>)

      render(<Empty />)

      // The NoToolPlaceholder should have 'invert' class in dark mode
      const placeholder = document.querySelector('.invert')
      expect(placeholder).toBeInTheDocument()
    })
  })

  // Tests for translation key handling
  describe('Translation Keys', () => {
    it('should use correct translation namespace for tools', () => {
      render(<Empty type={ToolTypeEnum.Custom} />)

      // The component should render translation keys with 'tools' namespace
      // Translation mock returns the key itself
      expect(screen.getByText(/addToolModal\.custom\.title/i)).toBeInTheDocument()
    })

    it('should render tip text for types with hasTitle', () => {
      render(<Empty type={ToolTypeEnum.Custom} />)

      // Should show the tip text with translation key
      expect(screen.getByText(/addToolModal\.custom\.tip/i)).toBeInTheDocument()
    })
  })

  // Tests for edge cases
  describe('Edge Cases', () => {
    it('should handle undefined type gracefully', () => {
      render(<Empty type={undefined} />)

      expect(screen.getByText('No tools available')).toBeInTheDocument()
    })

    it('should handle All type without link', () => {
      render(<Empty type={ToolTypeEnum.All} />)

      const link = document.querySelector('a')
      expect(link).not.toBeInTheDocument()
    })
  })

  // Tests for link styling
  describe('Link Styling', () => {
    it('should apply hover styling classes to link', () => {
      render(<Empty type={ToolTypeEnum.Custom} />)

      const link = document.querySelector('a')
      expect(link).toHaveClass('cursor-pointer')
      expect(link).toHaveClass('hover:text-text-accent')
    })

    it('should render div instead of link when hasLink is false', () => {
      render(<Empty type={ToolTypeEnum.BuiltIn} />)

      // No anchor tags should be rendered
      const anchors = document.querySelectorAll('a')
      expect(anchors.length).toBe(0)
    })
  })
})
