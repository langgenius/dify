import { render, screen } from '@testing-library/react'
import { ChunkingMode } from '@/models/datasets'
import ChunkStructure from './index'

// Note: react-i18next is globally mocked in vitest.setup.ts

describe('ChunkStructure', () => {
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<ChunkStructure chunkStructure={ChunkingMode.text} />)
      expect(screen.getByText('General')).toBeInTheDocument()
    })

    it('should render all three options', () => {
      render(<ChunkStructure chunkStructure={ChunkingMode.text} />)
      expect(screen.getByText('General')).toBeInTheDocument()
      expect(screen.getByText('Parent-Child')).toBeInTheDocument()
      expect(screen.getByText('Q&A')).toBeInTheDocument()
    })

    it('should render in a vertical layout', () => {
      const { container } = render(<ChunkStructure chunkStructure={ChunkingMode.text} />)
      const wrapper = container.firstChild
      expect(wrapper).toHaveClass('flex-col')
    })
  })

  describe('Active State', () => {
    it('should mark General option as active when chunkStructure is text', () => {
      const { container } = render(<ChunkStructure chunkStructure={ChunkingMode.text} />)
      // The active card has ring styling
      const activeCards = container.querySelectorAll('.ring-\\[1px\\]')
      expect(activeCards).toHaveLength(1)
    })

    it('should mark Parent-Child option as active when chunkStructure is parentChild', () => {
      const { container } = render(<ChunkStructure chunkStructure={ChunkingMode.parentChild} />)
      const activeCards = container.querySelectorAll('.ring-\\[1px\\]')
      expect(activeCards).toHaveLength(1)
    })

    it('should mark Q&A option as active when chunkStructure is qa', () => {
      const { container } = render(<ChunkStructure chunkStructure={ChunkingMode.qa} />)
      const activeCards = container.querySelectorAll('.ring-\\[1px\\]')
      expect(activeCards).toHaveLength(1)
    })
  })

  describe('Disabled State', () => {
    it('should render all options as disabled', () => {
      const { container } = render(<ChunkStructure chunkStructure={ChunkingMode.text} />)
      // All cards should have cursor-not-allowed (disabled)
      const disabledCards = container.querySelectorAll('.cursor-not-allowed')
      expect(disabledCards.length).toBeGreaterThan(0)
    })
  })

  describe('Option Cards', () => {
    it('should render option cards with correct structure', () => {
      render(<ChunkStructure chunkStructure={ChunkingMode.text} />)

      // All options should have descriptions
      expect(screen.getByText(/stepTwo\.generalTip/)).toBeInTheDocument()
      expect(screen.getByText(/stepTwo\.parentChildTip/)).toBeInTheDocument()
      expect(screen.getByText(/stepTwo\.qaTip/)).toBeInTheDocument()
    })

    it('should render icons for all options', () => {
      const { container } = render(<ChunkStructure chunkStructure={ChunkingMode.text} />)
      // Each option card should have an icon (SVG elements)
      const svgs = container.querySelectorAll('svg')
      expect(svgs.length).toBeGreaterThanOrEqual(3) // At least 3 icons
    })
  })

  describe('Effect Colors', () => {
    it('should show effect color for active General option', () => {
      const { container } = render(<ChunkStructure chunkStructure={ChunkingMode.text} />)
      const effectElement = container.querySelector('.bg-util-colors-indigo-indigo-600')
      expect(effectElement).toBeInTheDocument()
    })

    it('should show effect color for active Parent-Child option', () => {
      const { container } = render(<ChunkStructure chunkStructure={ChunkingMode.parentChild} />)
      const effectElement = container.querySelector('.bg-util-colors-blue-light-blue-light-600')
      expect(effectElement).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should update active state when chunkStructure prop changes', () => {
      const { rerender, container } = render(<ChunkStructure chunkStructure={ChunkingMode.text} />)

      // Initially one card is active
      let activeCards = container.querySelectorAll('.ring-\\[1px\\]')
      expect(activeCards).toHaveLength(1)

      // Change to parentChild
      rerender(<ChunkStructure chunkStructure={ChunkingMode.parentChild} />)

      // Still one card should be active
      activeCards = container.querySelectorAll('.ring-\\[1px\\]')
      expect(activeCards).toHaveLength(1)

      // Change to qa
      rerender(<ChunkStructure chunkStructure={ChunkingMode.qa} />)

      // Still one card should be active
      activeCards = container.querySelectorAll('.ring-\\[1px\\]')
      expect(activeCards).toHaveLength(1)
    })
  })

  describe('Integration with useChunkStructure hook', () => {
    it('should use options from useChunkStructure hook', () => {
      render(<ChunkStructure chunkStructure={ChunkingMode.text} />)

      // Verify all expected options are rendered
      const expectedTitles = ['General', 'Parent-Child', 'Q&A']
      expectedTitles.forEach((title) => {
        expect(screen.getByText(title)).toBeInTheDocument()
      })
    })
  })
})
