import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FooterTip from './footer-tip'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('FooterTip', () => {
  describe('rendering', () => {
    it('should render without crashing', () => {
      render(<FooterTip />)

      expect(screen.getByText('Drag to adjust grouping')).toBeInTheDocument()
    })

    it('should render the drag tip text', () => {
      render(<FooterTip />)

      expect(screen.getByText('Drag to adjust grouping')).toBeInTheDocument()
    })

    it('should have correct container classes', () => {
      const { container } = render(<FooterTip />)

      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('flex', 'shrink-0', 'items-center', 'justify-center', 'gap-x-2', 'py-4')
    })

    it('should have correct text styling', () => {
      render(<FooterTip />)

      const text = screen.getByText('Drag to adjust grouping')
      expect(text).toHaveClass('system-xs-regular')
    })

    it('should have correct text color', () => {
      const { container } = render(<FooterTip />)

      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('text-text-quaternary')
    })

    it('should render the drag icon', () => {
      const { container } = render(<FooterTip />)

      // The RiDragDropLine icon should be rendered
      const icon = container.querySelector('.size-4')
      expect(icon).toBeInTheDocument()
    })
  })

  describe('memoization', () => {
    it('should be wrapped with React.memo', () => {
      expect((FooterTip as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for('react.memo'))
    })
  })
})
