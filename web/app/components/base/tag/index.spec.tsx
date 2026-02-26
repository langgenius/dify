import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Tag from './index'
import '@testing-library/jest-dom/vitest'

describe('Tag Component', () => {
  describe('Rendering', () => {
    it('should render with text children', () => {
      const { container } = render(<Tag>Hello World</Tag>)
      expect(container.firstChild).toHaveTextContent('Hello World')
    })

    it('should render with ReactNode children', () => {
      render(<Tag><span data-testid="child">Node</span></Tag>)
      expect(screen.getByTestId('child')).toBeInTheDocument()
    })

    it('should always apply base layout classes', () => {
      const { container } = render(<Tag>Test</Tag>)
      expect(container.firstChild).toHaveClass(
        'inline-flex',
        'shrink-0',
        'items-center',
        'rounded-md',
        'px-2.5',
        'py-px',
        'text-xs',
        'leading-5',
      )
    })
  })

  describe('Color Variants', () => {
    it.each([
      { color: 'green', text: 'text-green-800', bg: 'bg-green-100' },
      { color: 'yellow', text: 'text-yellow-800', bg: 'bg-yellow-100' },
      { color: 'red', text: 'text-red-800', bg: 'bg-red-100' },
      { color: 'gray', text: 'text-gray-800', bg: 'bg-gray-100' },
    ])('should apply $color color classes', ({ color, text, bg }) => {
      type colorType = 'green' | 'yellow' | 'red' | 'gray' | undefined
      const { container } = render(<Tag color={color as colorType}>Test</Tag>)
      expect(container.firstChild).toHaveClass(text, bg)
    })

    it('should default to green when no color specified', () => {
      const { container } = render(<Tag>Test</Tag>)
      expect(container.firstChild).toHaveClass('text-green-800', 'bg-green-100')
    })

    it('should not apply color classes for invalid color', () => {
      type colorType = 'green' | 'yellow' | 'red' | 'gray' | undefined
      const { container } = render(<Tag color={'invalid' as colorType}>Test</Tag>)
      const className = (container.firstChild as HTMLElement)?.className || ''

      expect(className).not.toMatch(/text-(green|yellow|red|gray)-800/)
      expect(className).not.toMatch(/bg-(green|yellow|red|gray)-100/)
    })
  })

  describe('Boolean Props', () => {
    it('should apply border when bordered is true', () => {
      const { container } = render(<Tag bordered>Test</Tag>)
      expect(container.firstChild).toHaveClass('border-[1px]')
    })

    it('should not apply border by default', () => {
      const { container } = render(<Tag>Test</Tag>)
      expect(container.firstChild).not.toHaveClass('border-[1px]')
    })

    it('should hide background when hideBg is true', () => {
      const { container } = render(<Tag hideBg>Test</Tag>)
      expect(container.firstChild).toHaveClass('bg-transparent')
    })

    it('should apply both bordered and hideBg together', () => {
      const { container } = render(<Tag bordered hideBg>Test</Tag>)
      expect(container.firstChild).toHaveClass('border-[1px]', 'bg-transparent')
    })

    it('should override color background with hideBg', () => {
      const { container } = render(<Tag color="red" hideBg>Test</Tag>)
      const tag = container.firstChild
      expect(tag).toHaveClass('bg-transparent', 'text-red-800')
    })
  })

  describe('Custom Styling', () => {
    it('should merge custom className', () => {
      const { container } = render(<Tag className="my-custom-class">Test</Tag>)
      expect(container.firstChild).toHaveClass('my-custom-class')
    })

    it('should preserve base classes with custom className', () => {
      const { container } = render(<Tag className="my-custom-class">Test</Tag>)
      expect(container.firstChild).toHaveClass('inline-flex', 'my-custom-class')
    })

    it('should handle empty className prop', () => {
      const { container } = render(<Tag className="">Test</Tag>)
      expect(container.firstChild).toBeInTheDocument()
    })
  })
})
