import React from 'react'
import { render, screen } from '@testing-library/react'

// Track mock calls
let documentTitleCalls: string[] = []
let educationInitCalls: number = 0

// Mock useDocumentTitle hook
vi.mock('@/hooks/use-document-title', () => ({
  __esModule: true,
  default: (title: string) => {
    documentTitleCalls.push(title)
  },
}))

// Mock useEducationInit hook
vi.mock('@/app/education-apply/hooks', () => ({
  useEducationInit: () => {
    educationInitCalls++
  },
}))

// Mock List component
vi.mock('./list', () => ({
  __esModule: true,
  default: () => {
    const React = require('react')
    return React.createElement('div', { 'data-testid': 'apps-list' }, 'Apps List')
  },
}))

// Import after mocks
import Apps from './index'

describe('Apps', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    documentTitleCalls = []
    educationInitCalls = 0
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<Apps />)
      expect(screen.getByTestId('apps-list')).toBeInTheDocument()
    })

    it('should render List component', () => {
      render(<Apps />)
      expect(screen.getByText('Apps List')).toBeInTheDocument()
    })

    it('should have correct container structure', () => {
      const { container } = render(<Apps />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('relative', 'flex', 'h-0', 'shrink-0', 'grow', 'flex-col')
    })
  })

  describe('Hooks', () => {
    it('should call useDocumentTitle with correct title', () => {
      render(<Apps />)
      expect(documentTitleCalls).toContain('common.menus.apps')
    })

    it('should call useEducationInit', () => {
      render(<Apps />)
      expect(educationInitCalls).toBeGreaterThan(0)
    })
  })

  describe('Integration', () => {
    it('should render full component tree', () => {
      render(<Apps />)

      // Verify container exists
      expect(screen.getByTestId('apps-list')).toBeInTheDocument()

      // Verify hooks were called
      expect(documentTitleCalls.length).toBeGreaterThanOrEqual(1)
      expect(educationInitCalls).toBeGreaterThanOrEqual(1)
    })

    it('should handle multiple renders', () => {
      const { rerender } = render(<Apps />)
      expect(screen.getByTestId('apps-list')).toBeInTheDocument()

      rerender(<Apps />)
      expect(screen.getByTestId('apps-list')).toBeInTheDocument()
    })
  })

  describe('Styling', () => {
    it('should have overflow-y-auto class', () => {
      const { container } = render(<Apps />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('overflow-y-auto')
    })

    it('should have background styling', () => {
      const { container } = render(<Apps />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('bg-background-body')
    })
  })
})
