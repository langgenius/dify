import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ResultItemMeta from './result-item-meta'

describe('ResultItemMeta', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering tests for the result item meta component
  describe('Rendering', () => {
    it('should render the segment index tag with prefix and position', () => {
      // Arrange & Act
      render(
        <ResultItemMeta
          labelPrefix="Chunk"
          positionId={3}
          wordCount={150}
          score={0.9}
        />,
      )

      // Assert
      expect(screen.getByText('Chunk-03')).toBeInTheDocument()
    })

    it('should render the word count', () => {
      // Arrange & Act
      render(
        <ResultItemMeta
          labelPrefix="Chunk"
          positionId={1}
          wordCount={250}
          score={0.8}
        />,
      )

      // Assert
      expect(screen.getByText(/250/)).toBeInTheDocument()
      expect(screen.getByText(/characters/i)).toBeInTheDocument()
    })

    it('should render the score component', () => {
      // Arrange & Act
      render(
        <ResultItemMeta
          labelPrefix="Chunk"
          positionId={1}
          wordCount={100}
          score={0.75}
        />,
      )

      // Assert
      expect(screen.getByText('0.75')).toBeInTheDocument()
      expect(screen.getByText('score')).toBeInTheDocument()
    })

    it('should apply custom className', () => {
      // Arrange & Act
      const { container } = render(
        <ResultItemMeta
          className="custom-meta"
          labelPrefix="Chunk"
          positionId={1}
          wordCount={100}
          score={0.5}
        />,
      )

      // Assert
      expect(container.firstElementChild?.className).toContain('custom-meta')
    })

    it('should render dot separator', () => {
      // Arrange & Act
      render(
        <ResultItemMeta
          labelPrefix="Chunk"
          positionId={1}
          wordCount={100}
          score={0.5}
        />,
      )

      // Assert
      expect(screen.getByText('·')).toBeInTheDocument()
    })
  })
})
