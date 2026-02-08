import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import List from './index'

// Mock child components
vi.mock('./built-in-pipeline-list', () => ({
  default: () => <div data-testid="built-in-list">BuiltInPipelineList</div>,
}))

vi.mock('./customized-list', () => ({
  default: () => <div data-testid="customized-list">CustomizedList</div>,
}))

// ============================================================================
// List Component Tests
// ============================================================================

describe('List', () => {
  // --------------------------------------------------------------------------
  // Rendering Tests
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<List />)
      expect(screen.getByTestId('built-in-list')).toBeInTheDocument()
    })

    it('should render BuiltInPipelineList component', () => {
      render(<List />)
      expect(screen.getByTestId('built-in-list')).toBeInTheDocument()
    })

    it('should render CustomizedList component', () => {
      render(<List />)
      expect(screen.getByTestId('customized-list')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Layout Tests
  // --------------------------------------------------------------------------
  describe('Layout', () => {
    it('should have proper container classes', () => {
      const { container } = render(<List />)
      const listDiv = container.firstChild as HTMLElement
      expect(listDiv).toHaveClass('grow', 'overflow-y-auto', 'px-16', 'pb-[60px]', 'pt-1')
    })

    it('should have gap between items', () => {
      const { container } = render(<List />)
      const listDiv = container.firstChild as HTMLElement
      expect(listDiv).toHaveClass('gap-y-1')
    })
  })

  // --------------------------------------------------------------------------
  // Component Order Tests
  // --------------------------------------------------------------------------
  describe('Component Order', () => {
    it('should render BuiltInPipelineList before CustomizedList', () => {
      const { container } = render(<List />)
      const children = Array.from(container.firstChild?.childNodes || [])

      expect(children.length).toBe(2)
      expect((children[0] as HTMLElement).getAttribute('data-testid')).toBe('built-in-list')
      expect((children[1] as HTMLElement).getAttribute('data-testid')).toBe('customized-list')
    })
  })
})
