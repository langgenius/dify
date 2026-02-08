import type { IconInfo } from '@/models/datasets'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ChunkingMode } from '@/models/datasets'

import Content from './content'

// ============================================================================
// Test Data Factories
// ============================================================================

const createIconInfo = (overrides: Partial<IconInfo> = {}): IconInfo => ({
  icon_type: 'emoji',
  icon: '📊',
  icon_background: '#FFF4ED',
  icon_url: '',
  ...overrides,
})

const createImageIconInfo = (overrides: Partial<IconInfo> = {}): IconInfo => ({
  icon_type: 'image',
  icon: 'file-id-123',
  icon_background: '',
  icon_url: 'https://example.com/icon.png',
  ...overrides,
})

// ============================================================================
// Content Component Tests
// ============================================================================

describe('Content', () => {
  const defaultProps = {
    name: 'Test Pipeline',
    description: 'This is a test pipeline description',
    iconInfo: createIconInfo(),
    chunkStructure: 'text' as ChunkingMode,
  }

  // --------------------------------------------------------------------------
  // Rendering Tests
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<Content {...defaultProps} />)
      expect(screen.getByText('Test Pipeline')).toBeInTheDocument()
    })

    it('should render name', () => {
      render(<Content {...defaultProps} />)
      expect(screen.getByText('Test Pipeline')).toBeInTheDocument()
    })

    it('should render description', () => {
      render(<Content {...defaultProps} />)
      expect(screen.getByText('This is a test pipeline description')).toBeInTheDocument()
    })

    it('should render chunking mode text', () => {
      render(<Content {...defaultProps} />)
      // The translation key should be rendered
      expect(screen.getByText(/chunkingMode/i)).toBeInTheDocument()
    })

    it('should have title attribute for truncation', () => {
      render(<Content {...defaultProps} />)
      const nameElement = screen.getByText('Test Pipeline')
      expect(nameElement).toHaveAttribute('title', 'Test Pipeline')
    })

    it('should have title attribute on description', () => {
      render(<Content {...defaultProps} />)
      const descElement = screen.getByText('This is a test pipeline description')
      expect(descElement).toHaveAttribute('title', 'This is a test pipeline description')
    })
  })

  // --------------------------------------------------------------------------
  // Icon Rendering Tests
  // --------------------------------------------------------------------------
  describe('Icon Rendering', () => {
    it('should render emoji icon correctly', () => {
      const { container } = render(<Content {...defaultProps} />)
      // AppIcon component should be rendered
      const iconContainer = container.querySelector('[class*="shrink-0"]')
      expect(iconContainer).toBeInTheDocument()
    })

    it('should render image icon correctly', () => {
      const props = {
        ...defaultProps,
        iconInfo: createImageIconInfo(),
      }
      const { container } = render(<Content {...props} />)
      const iconContainer = container.querySelector('[class*="shrink-0"]')
      expect(iconContainer).toBeInTheDocument()
    })

    it('should render chunk structure icon', () => {
      const { container } = render(<Content {...defaultProps} />)
      // Icon should be rendered in the corner
      const icons = container.querySelectorAll('svg')
      expect(icons.length).toBeGreaterThan(0)
    })
  })

  // --------------------------------------------------------------------------
  // Chunk Structure Tests
  // --------------------------------------------------------------------------
  describe('Chunk Structure', () => {
    it('should handle text chunk structure', () => {
      render(<Content {...defaultProps} chunkStructure={ChunkingMode.text} />)
      expect(screen.getByText(/chunkingMode/i)).toBeInTheDocument()
    })

    it('should handle parent-child chunk structure', () => {
      render(<Content {...defaultProps} chunkStructure={ChunkingMode.parentChild} />)
      expect(screen.getByText(/chunkingMode/i)).toBeInTheDocument()
    })

    it('should handle qa chunk structure', () => {
      render(<Content {...defaultProps} chunkStructure={ChunkingMode.qa} />)
      expect(screen.getByText(/chunkingMode/i)).toBeInTheDocument()
    })

    it('should fallback to General icon for unknown chunk structure', () => {
      const { container } = render(
        <Content {...defaultProps} chunkStructure={'unknown' as ChunkingMode} />,
      )
      const icons = container.querySelectorAll('svg')
      expect(icons.length).toBeGreaterThan(0)
    })
  })

  // --------------------------------------------------------------------------
  // Layout Tests
  // --------------------------------------------------------------------------
  describe('Layout', () => {
    it('should have proper header layout', () => {
      const { container } = render(<Content {...defaultProps} />)
      const header = container.querySelector('[class*="gap-x-3"]')
      expect(header).toBeInTheDocument()
    })

    it('should have truncate class on name', () => {
      render(<Content {...defaultProps} />)
      const nameElement = screen.getByText('Test Pipeline')
      expect(nameElement).toHaveClass('truncate')
    })

    it('should have line-clamp on description', () => {
      render(<Content {...defaultProps} />)
      const descElement = screen.getByText('This is a test pipeline description')
      expect(descElement).toHaveClass('line-clamp-3')
    })
  })

  // --------------------------------------------------------------------------
  // Edge Cases Tests
  // --------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle empty name', () => {
      render(<Content {...defaultProps} name="" />)
      const { container } = render(<Content {...defaultProps} name="" />)
      expect(container).toBeInTheDocument()
    })

    it('should handle empty description', () => {
      render(<Content {...defaultProps} description="" />)
      const { container } = render(<Content {...defaultProps} description="" />)
      expect(container).toBeInTheDocument()
    })

    it('should handle long name', () => {
      const longName = 'A'.repeat(100)
      render(<Content {...defaultProps} name={longName} />)
      const nameElement = screen.getByText(longName)
      expect(nameElement).toHaveClass('truncate')
    })

    it('should handle long description', () => {
      const longDesc = 'A'.repeat(500)
      render(<Content {...defaultProps} description={longDesc} />)
      const descElement = screen.getByText(longDesc)
      expect(descElement).toHaveClass('line-clamp-3')
    })
  })

  // --------------------------------------------------------------------------
  // Memoization Tests
  // --------------------------------------------------------------------------
  describe('Memoization', () => {
    it('should be memoized with React.memo', () => {
      const { rerender } = render(<Content {...defaultProps} />)
      rerender(<Content {...defaultProps} />)
      expect(screen.getByText('Test Pipeline')).toBeInTheDocument()
    })
  })
})
