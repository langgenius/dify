import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ChunkingModeLabel from './chunking-mode-label'

describe('ChunkingModeLabel', () => {
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<ChunkingModeLabel isGeneralMode={true} isQAMode={false} />)
      expect(screen.getByText(/general/i)).toBeInTheDocument()
    })

    it('should render with Badge wrapper', () => {
      const { container } = render(<ChunkingModeLabel isGeneralMode={true} isQAMode={false} />)
      // Badge component renders with specific styles
      expect(container.querySelector('.flex')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should display general mode text when isGeneralMode is true', () => {
      render(<ChunkingModeLabel isGeneralMode={true} isQAMode={false} />)
      expect(screen.getByText(/general/i)).toBeInTheDocument()
    })

    it('should display parent-child mode text when isGeneralMode is false', () => {
      render(<ChunkingModeLabel isGeneralMode={false} isQAMode={false} />)
      expect(screen.getByText(/parentChild/i)).toBeInTheDocument()
    })

    it('should append QA suffix when isGeneralMode and isQAMode are both true', () => {
      render(<ChunkingModeLabel isGeneralMode={true} isQAMode={true} />)
      expect(screen.getByText(/general.*QA/i)).toBeInTheDocument()
    })

    it('should not append QA suffix when isGeneralMode is true but isQAMode is false', () => {
      render(<ChunkingModeLabel isGeneralMode={true} isQAMode={false} />)
      const text = screen.getByText(/general/i)
      expect(text.textContent).not.toContain('QA')
    })

    it('should not display QA suffix for parent-child mode even when isQAMode is true', () => {
      render(<ChunkingModeLabel isGeneralMode={false} isQAMode={true} />)
      expect(screen.getByText(/parentChild/i)).toBeInTheDocument()
      expect(screen.queryByText(/QA/i)).not.toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should render icon element', () => {
      const { container } = render(<ChunkingModeLabel isGeneralMode={true} isQAMode={false} />)
      const iconElement = container.querySelector('svg')
      expect(iconElement).toBeInTheDocument()
    })

    it('should apply correct icon size classes', () => {
      const { container } = render(<ChunkingModeLabel isGeneralMode={true} isQAMode={false} />)
      const iconElement = container.querySelector('svg')
      expect(iconElement).toHaveClass('h-3', 'w-3')
    })
  })
})
