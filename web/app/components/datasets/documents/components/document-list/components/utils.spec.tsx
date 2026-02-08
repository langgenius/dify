import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderTdValue } from './utils'

describe('renderTdValue', () => {
  describe('Rendering', () => {
    it('should render string value correctly', () => {
      const { container } = render(<>{renderTdValue('test value')}</>)
      expect(screen.getByText('test value')).toBeInTheDocument()
      expect(container.querySelector('div')).toHaveClass('text-text-secondary')
    })

    it('should render number value correctly', () => {
      const { container } = render(<>{renderTdValue(42)}</>)
      expect(screen.getByText('42')).toBeInTheDocument()
      expect(container.querySelector('div')).toHaveClass('text-text-secondary')
    })

    it('should render zero correctly', () => {
      const { container } = render(<>{renderTdValue(0)}</>)
      expect(screen.getByText('0')).toBeInTheDocument()
      expect(container.querySelector('div')).toHaveClass('text-text-secondary')
    })
  })

  describe('Null and undefined handling', () => {
    it('should render dash for null value', () => {
      render(<>{renderTdValue(null)}</>)
      expect(screen.getByText('-')).toBeInTheDocument()
    })

    it('should render dash for null value with empty style', () => {
      const { container } = render(<>{renderTdValue(null, true)}</>)
      expect(screen.getByText('-')).toBeInTheDocument()
      expect(container.querySelector('div')).toHaveClass('text-text-tertiary')
    })
  })

  describe('Empty style', () => {
    it('should apply text-text-tertiary class when isEmptyStyle is true', () => {
      const { container } = render(<>{renderTdValue('value', true)}</>)
      expect(container.querySelector('div')).toHaveClass('text-text-tertiary')
    })

    it('should apply text-text-secondary class when isEmptyStyle is false', () => {
      const { container } = render(<>{renderTdValue('value', false)}</>)
      expect(container.querySelector('div')).toHaveClass('text-text-secondary')
    })

    it('should apply text-text-secondary class when isEmptyStyle is not provided', () => {
      const { container } = render(<>{renderTdValue('value')}</>)
      expect(container.querySelector('div')).toHaveClass('text-text-secondary')
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty string', () => {
      render(<>{renderTdValue('')}</>)
      // Empty string should still render but with no visible text
      const div = document.querySelector('div')
      expect(div).toBeInTheDocument()
    })

    it('should handle large numbers', () => {
      render(<>{renderTdValue(1234567890)}</>)
      expect(screen.getByText('1234567890')).toBeInTheDocument()
    })

    it('should handle negative numbers', () => {
      render(<>{renderTdValue(-42)}</>)
      expect(screen.getByText('-42')).toBeInTheDocument()
    })

    it('should handle special characters in string', () => {
      render(<>{renderTdValue('<script>alert("xss")</script>')}</>)
      expect(screen.getByText('<script>alert("xss")</script>')).toBeInTheDocument()
    })

    it('should handle unicode characters', () => {
      render(<>{renderTdValue('Test Unicode: \u4E2D\u6587')}</>)
      expect(screen.getByText('Test Unicode: \u4E2D\u6587')).toBeInTheDocument()
    })

    it('should handle very long strings', () => {
      const longString = 'a'.repeat(1000)
      render(<>{renderTdValue(longString)}</>)
      expect(screen.getByText(longString)).toBeInTheDocument()
    })
  })
})
