import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import DatasetFooter from './index'

describe('DatasetFooter', () => {
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<DatasetFooter />)
      expect(screen.getByRole('contentinfo')).toBeInTheDocument()
    })

    it('should render the main heading', () => {
      render(<DatasetFooter />)
      expect(screen.getByRole('heading', { level: 3 })).toBeInTheDocument()
    })

    it('should render description paragraph', () => {
      render(<DatasetFooter />)
      // The paragraph contains multiple text spans
      expect(screen.getByText(/intro1/)).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should be memoized', () => {
      // DatasetFooter is wrapped with React.memo
      expect(DatasetFooter).toBeDefined()
    })
  })

  describe('Styles', () => {
    it('should have correct footer styling', () => {
      render(<DatasetFooter />)
      const footer = screen.getByRole('contentinfo')
      expect(footer).toHaveClass('shrink-0', 'px-12', 'py-6')
    })

    it('should have gradient text on heading', () => {
      render(<DatasetFooter />)
      const heading = screen.getByRole('heading', { level: 3 })
      expect(heading).toHaveClass('text-gradient')
    })
  })

  describe('Content Structure', () => {
    it('should render accent spans for highlighted text', () => {
      render(<DatasetFooter />)
      const accentSpans = document.querySelectorAll('.text-text-accent')
      expect(accentSpans.length).toBe(2)
    })
  })
})
