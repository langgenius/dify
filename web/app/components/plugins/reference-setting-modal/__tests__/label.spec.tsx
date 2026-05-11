import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Label from '../label'

describe('Label', () => {
  describe('Rendering', () => {
    it('should render label text', () => {
      render(<Label label="Test Label" />)
      expect(screen.getByText('Test Label')).toBeInTheDocument()
    })

    it('should render with label only when no description provided', () => {
      const { container } = render(<Label label="Simple Label" />)
      expect(screen.getByText('Simple Label')).toBeInTheDocument()
      expect(container.querySelector('.h-6')).toBeInTheDocument()
    })

    it('should render label and description when both provided', () => {
      render(<Label label="Label Text" description="Description Text" />)
      expect(screen.getByText('Label Text')).toBeInTheDocument()
      expect(screen.getByText('Description Text')).toBeInTheDocument()
    })

    it('should apply h-4 class to label container when description is provided', () => {
      const { container } = render(<Label label="Label" description="Has description" />)
      expect(container.querySelector('.h-4')).toBeInTheDocument()
    })

    it('should not render description element when description is undefined', () => {
      const { container } = render(<Label label="Only Label" />)
      expect(container.querySelectorAll('.body-xs-regular')).toHaveLength(0)
    })

    it('should render description with correct styling', () => {
      const { container } = render(<Label label="Label" description="Styled Description" />)
      const descriptionElement = container.querySelector('.body-xs-regular')
      expect(descriptionElement).toBeInTheDocument()
      expect(descriptionElement).toHaveClass('mt-1', 'text-text-tertiary')
    })
  })

  describe('Props Variations', () => {
    it('should handle empty label string', () => {
      const { container } = render(<Label label="" />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should handle empty description string', () => {
      render(<Label label="Label" description="" />)
      expect(screen.getByText('Label')).toBeInTheDocument()
    })

    it('should handle long label text', () => {
      const longLabel = 'A'.repeat(200)
      render(<Label label={longLabel} />)
      expect(screen.getByText(longLabel)).toBeInTheDocument()
    })

    it('should handle long description text', () => {
      const longDescription = 'B'.repeat(500)
      render(<Label label="Label" description={longDescription} />)
      expect(screen.getByText(longDescription)).toBeInTheDocument()
    })

    it('should handle special characters in label', () => {
      const specialLabel = '<script>alert("xss")</script>'
      render(<Label label={specialLabel} />)
      expect(screen.getByText(specialLabel)).toBeInTheDocument()
    })

    it('should handle special characters in description', () => {
      const specialDescription = '!@#$%^&*()_+-=[]{}|;:,.<>?'
      render(<Label label="Label" description={specialDescription} />)
      expect(screen.getByText(specialDescription)).toBeInTheDocument()
    })
  })

  describe('Component Memoization', () => {
    it('should be memoized with React.memo', () => {
      expect(Label).toBeDefined()
      // eslint-disable-next-line ts/no-explicit-any
      expect((Label as any).$$typeof?.toString()).toContain('Symbol')
    })
  })

  describe('Styling', () => {
    it('should apply system-sm-semibold class to label', () => {
      const { container } = render(<Label label="Styled Label" />)
      expect(container.querySelector('.system-sm-semibold')).toBeInTheDocument()
    })

    it('should apply text-text-secondary class to label', () => {
      const { container } = render(<Label label="Styled Label" />)
      expect(container.querySelector('.text-text-secondary')).toBeInTheDocument()
    })
  })
})
