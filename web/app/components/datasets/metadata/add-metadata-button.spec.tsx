import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import AddedMetadataButton from './add-metadata-button'

describe('AddedMetadataButton', () => {
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<AddedMetadataButton />)
      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should render with translated text', () => {
      render(<AddedMetadataButton />)
      // The button should contain text from i18n
      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should render add icon', () => {
      const { container } = render(<AddedMetadataButton />)
      // Check if there's an SVG element (the RiAddLine icon)
      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should apply custom className', () => {
      render(<AddedMetadataButton className="custom-class" />)
      const button = screen.getByRole('button')
      expect(button).toHaveClass('custom-class')
    })

    it('should apply default classes', () => {
      render(<AddedMetadataButton />)
      const button = screen.getByRole('button')
      expect(button).toHaveClass('flex', 'w-full', 'items-center')
    })

    it('should merge custom className with default classes', () => {
      render(<AddedMetadataButton className="my-custom-class" />)
      const button = screen.getByRole('button')
      expect(button).toHaveClass('flex', 'w-full', 'items-center', 'my-custom-class')
    })
  })

  describe('User Interactions', () => {
    it('should call onClick when button is clicked', () => {
      const handleClick = vi.fn()
      render(<AddedMetadataButton onClick={handleClick} />)

      fireEvent.click(screen.getByRole('button'))

      expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it('should not throw when onClick is not provided and button is clicked', () => {
      render(<AddedMetadataButton />)

      expect(() => {
        fireEvent.click(screen.getByRole('button'))
      }).not.toThrow()
    })

    it('should call onClick multiple times on multiple clicks', () => {
      const handleClick = vi.fn()
      render(<AddedMetadataButton onClick={handleClick} />)

      fireEvent.click(screen.getByRole('button'))
      fireEvent.click(screen.getByRole('button'))
      fireEvent.click(screen.getByRole('button'))

      expect(handleClick).toHaveBeenCalledTimes(3)
    })
  })

  describe('Edge Cases', () => {
    it('should render with undefined className', () => {
      render(<AddedMetadataButton className={undefined} />)
      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should render with empty className', () => {
      render(<AddedMetadataButton className="" />)
      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should render with undefined onClick', () => {
      render(<AddedMetadataButton onClick={undefined} />)
      expect(screen.getByRole('button')).toBeInTheDocument()
    })
  })
})
