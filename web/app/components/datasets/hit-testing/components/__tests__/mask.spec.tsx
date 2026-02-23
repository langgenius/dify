import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Mask from '../mask'

describe('Mask', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering tests for the gradient overlay component
  describe('Rendering', () => {
    it('should render a gradient overlay div', () => {
      const { container } = render(<Mask />)

      const div = container.firstElementChild
      expect(div).toBeInTheDocument()
      expect(div?.className).toContain('h-12')
      expect(div?.className).toContain('bg-gradient-to-b')
    })

    it('should apply custom className', () => {
      const { container } = render(<Mask className="custom-mask" />)

      expect(container.firstElementChild?.className).toContain('custom-mask')
    })

    it('should render without custom className', () => {
      const { container } = render(<Mask />)

      expect(container.firstElementChild).toBeInTheDocument()
    })
  })
})
