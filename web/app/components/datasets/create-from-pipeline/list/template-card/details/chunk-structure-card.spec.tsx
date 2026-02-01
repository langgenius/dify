import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import ChunkStructureCard from './chunk-structure-card'
import { EffectColor } from './types'

// ============================================================================
// ChunkStructureCard Component Tests
// ============================================================================

describe('ChunkStructureCard', () => {
  const defaultProps = {
    icon: <span data-testid="test-icon">Icon</span>,
    title: 'General',
    description: 'General chunk structure description',
    effectColor: EffectColor.indigo,
  }

  // --------------------------------------------------------------------------
  // Rendering Tests
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<ChunkStructureCard {...defaultProps} />)
      expect(screen.getByText('General')).toBeInTheDocument()
    })

    it('should render title', () => {
      render(<ChunkStructureCard {...defaultProps} />)
      expect(screen.getByText('General')).toBeInTheDocument()
    })

    it('should render description', () => {
      render(<ChunkStructureCard {...defaultProps} />)
      expect(screen.getByText('General chunk structure description')).toBeInTheDocument()
    })

    it('should render icon', () => {
      render(<ChunkStructureCard {...defaultProps} />)
      expect(screen.getByTestId('test-icon')).toBeInTheDocument()
    })

    it('should not render description when empty', () => {
      render(<ChunkStructureCard {...defaultProps} description="" />)
      expect(screen.getByText('General')).toBeInTheDocument()
      expect(screen.queryByText('General chunk structure description')).not.toBeInTheDocument()
    })

    it('should not render description when undefined', () => {
      const { description: _, ...propsWithoutDesc } = defaultProps
      render(<ChunkStructureCard {...propsWithoutDesc} />)
      expect(screen.getByText('General')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Effect Colors Tests
  // --------------------------------------------------------------------------
  describe('Effect Colors', () => {
    it('should apply indigo effect color', () => {
      const { container } = render(
        <ChunkStructureCard {...defaultProps} effectColor={EffectColor.indigo} />,
      )
      const effectElement = container.querySelector('[class*="blur-"]')
      expect(effectElement).toHaveClass('bg-util-colors-indigo-indigo-600')
    })

    it('should apply blueLight effect color', () => {
      const { container } = render(
        <ChunkStructureCard {...defaultProps} effectColor={EffectColor.blueLight} />,
      )
      const effectElement = container.querySelector('[class*="blur-"]')
      expect(effectElement).toHaveClass('bg-util-colors-blue-light-blue-light-500')
    })

    it('should apply green effect color', () => {
      const { container } = render(
        <ChunkStructureCard {...defaultProps} effectColor={EffectColor.green} />,
      )
      const effectElement = container.querySelector('[class*="blur-"]')
      expect(effectElement).toHaveClass('bg-util-colors-teal-teal-600')
    })

    it('should handle none effect color', () => {
      const { container } = render(
        <ChunkStructureCard {...defaultProps} effectColor={EffectColor.none} />,
      )
      const effectElement = container.querySelector('[class*="blur-"]')
      expect(effectElement).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Icon Background Tests
  // --------------------------------------------------------------------------
  describe('Icon Background', () => {
    it('should apply indigo icon background', () => {
      const { container } = render(
        <ChunkStructureCard {...defaultProps} effectColor={EffectColor.indigo} />,
      )
      const iconBg = container.querySelector('[class*="bg-components-icon-bg"]')
      expect(iconBg).toHaveClass('bg-components-icon-bg-indigo-solid')
    })

    it('should apply blue light icon background', () => {
      const { container } = render(
        <ChunkStructureCard {...defaultProps} effectColor={EffectColor.blueLight} />,
      )
      const iconBg = container.querySelector('[class*="bg-components-icon-bg"]')
      expect(iconBg).toHaveClass('bg-components-icon-bg-blue-light-solid')
    })

    it('should apply green icon background', () => {
      const { container } = render(
        <ChunkStructureCard {...defaultProps} effectColor={EffectColor.green} />,
      )
      const iconBg = container.querySelector('[class*="bg-components-icon-bg"]')
      expect(iconBg).toHaveClass('bg-components-icon-bg-teal-solid')
    })
  })

  // --------------------------------------------------------------------------
  // Custom className Tests
  // --------------------------------------------------------------------------
  describe('Custom className', () => {
    it('should apply custom className', () => {
      const { container } = render(
        <ChunkStructureCard {...defaultProps} className="custom-class" />,
      )
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('custom-class')
    })

    it('should merge custom className with default classes', () => {
      const { container } = render(
        <ChunkStructureCard {...defaultProps} className="custom-class" />,
      )
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('relative', 'flex', 'custom-class')
    })
  })

  // --------------------------------------------------------------------------
  // Layout Tests
  // --------------------------------------------------------------------------
  describe('Layout', () => {
    it('should have proper card styling', () => {
      const { container } = render(<ChunkStructureCard {...defaultProps} />)
      const card = container.firstChild as HTMLElement
      expect(card).toHaveClass('relative', 'flex', 'overflow-hidden', 'rounded-xl')
    })

    it('should have border styling', () => {
      const { container } = render(<ChunkStructureCard {...defaultProps} />)
      const card = container.firstChild as HTMLElement
      expect(card).toHaveClass('border-[0.5px]', 'border-components-panel-border-subtle')
    })

    it('should have shadow styling', () => {
      const { container } = render(<ChunkStructureCard {...defaultProps} />)
      const card = container.firstChild as HTMLElement
      expect(card).toHaveClass('shadow-xs')
    })

    it('should have blur effect element', () => {
      const { container } = render(<ChunkStructureCard {...defaultProps} />)
      const blurElement = container.querySelector('[class*="blur-"]')
      expect(blurElement).toHaveClass('absolute', '-left-1', '-top-1', 'size-14', 'rounded-full')
    })
  })

  // --------------------------------------------------------------------------
  // Memoization Tests
  // --------------------------------------------------------------------------
  describe('Memoization', () => {
    it('should be memoized with React.memo', () => {
      const { rerender } = render(<ChunkStructureCard {...defaultProps} />)
      rerender(<ChunkStructureCard {...defaultProps} />)
      expect(screen.getByText('General')).toBeInTheDocument()
    })
  })
})
