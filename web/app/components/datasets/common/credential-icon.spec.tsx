import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CredentialIcon } from './credential-icon'

describe('CredentialIcon', () => {
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<CredentialIcon name="Test" />)
      expect(screen.getByText('T')).toBeInTheDocument()
    })

    it('should render first letter when no avatar provided', () => {
      render(<CredentialIcon name="Alice" />)
      expect(screen.getByText('A')).toBeInTheDocument()
    })

    it('should render image when avatarUrl is provided', () => {
      render(<CredentialIcon name="Test" avatarUrl="https://example.com/avatar.png" />)
      const img = screen.getByRole('img')
      expect(img).toBeInTheDocument()
      expect(img).toHaveAttribute('src', 'https://example.com/avatar.png')
    })
  })

  describe('Props', () => {
    it('should apply default size of 20px', () => {
      const { container } = render(<CredentialIcon name="Test" />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveStyle({ width: '20px', height: '20px' })
    })

    it('should apply custom size', () => {
      const { container } = render(<CredentialIcon name="Test" size={40} />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveStyle({ width: '40px', height: '40px' })
    })

    it('should apply custom className', () => {
      const { container } = render(<CredentialIcon name="Test" className="custom-class" />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('custom-class')
    })

    it('should uppercase the first letter', () => {
      render(<CredentialIcon name="bob" />)
      expect(screen.getByText('B')).toBeInTheDocument()
    })

    it('should render fallback when avatarUrl is "default"', () => {
      render(<CredentialIcon name="Test" avatarUrl="default" />)
      expect(screen.getByText('T')).toBeInTheDocument()
      expect(screen.queryByRole('img')).not.toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should fallback to letter when image fails to load', () => {
      render(<CredentialIcon name="Test" avatarUrl="https://example.com/broken.png" />)

      // Initially shows image
      const img = screen.getByRole('img')
      expect(img).toBeInTheDocument()

      // Trigger error event
      fireEvent.error(img)

      // Should now show letter fallback
      expect(screen.getByText('T')).toBeInTheDocument()
      expect(screen.queryByRole('img')).not.toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle single character name', () => {
      render(<CredentialIcon name="A" />)
      expect(screen.getByText('A')).toBeInTheDocument()
    })

    it('should handle name starting with number', () => {
      render(<CredentialIcon name="123test" />)
      expect(screen.getByText('1')).toBeInTheDocument()
    })

    it('should handle name starting with special character', () => {
      render(<CredentialIcon name="@user" />)
      expect(screen.getByText('@')).toBeInTheDocument()
    })

    it('should assign consistent background colors based on first letter', () => {
      // Same first letter should get same color
      const { container: container1 } = render(<CredentialIcon name="Alice" />)
      const { container: container2 } = render(<CredentialIcon name="Anna" />)

      const wrapper1 = container1.firstChild as HTMLElement
      const wrapper2 = container2.firstChild as HTMLElement

      // Both should have the same bg class since they start with 'A'
      const classes1 = wrapper1.className
      const classes2 = wrapper2.className

      const bgClass1 = classes1.match(/bg-components-icon-bg-\S+/)?.[0]
      const bgClass2 = classes2.match(/bg-components-icon-bg-\S+/)?.[0]

      expect(bgClass1).toBe(bgClass2)
    })

    it('should apply different background colors for different letters', () => {
      // 'A' (65) % 4 = 1 → pink, 'B' (66) % 4 = 2 → indigo
      const { container: container1 } = render(<CredentialIcon name="Alice" />)
      const { container: container2 } = render(<CredentialIcon name="Bob" />)

      const wrapper1 = container1.firstChild as HTMLElement
      const wrapper2 = container2.firstChild as HTMLElement

      const bgClass1 = wrapper1.className.match(/bg-components-icon-bg-\S+/)?.[0]
      const bgClass2 = wrapper2.className.match(/bg-components-icon-bg-\S+/)?.[0]

      expect(bgClass1).toBeDefined()
      expect(bgClass2).toBeDefined()
      expect(bgClass1).not.toBe(bgClass2)
    })

    it('should handle empty avatarUrl string', () => {
      render(<CredentialIcon name="Test" avatarUrl="" />)
      expect(screen.getByText('T')).toBeInTheDocument()
      expect(screen.queryByRole('img')).not.toBeInTheDocument()
    })

    it('should render image with correct dimensions', () => {
      render(<CredentialIcon name="Test" avatarUrl="https://example.com/avatar.png" size={32} />)
      const img = screen.getByRole('img')
      expect(img).toHaveAttribute('width', '32')
      expect(img).toHaveAttribute('height', '32')
    })
  })
})
