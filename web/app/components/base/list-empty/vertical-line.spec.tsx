import { render } from '@testing-library/react'
import * as React from 'react'
import VerticalLine from './vertical-line'

describe('VerticalLine', () => {
  describe('Render', () => {
    it('renders correctly', () => {
      const { container } = render(<VerticalLine />)
      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
      expect(svg).toHaveAttribute('width', '2')
      expect(svg).toHaveAttribute('height', '132')
    })

    it('renders linear gradient definition', () => {
      const { container } = render(<VerticalLine />)
      const defs = container.querySelector('defs')
      const linearGradient = container.querySelector('linearGradient')
      expect(defs).toBeInTheDocument()
      expect(linearGradient).toBeInTheDocument()
      expect(linearGradient).toHaveAttribute('id', 'paint0_linear_8619_59128')
    })
  })

  describe('Style', () => {
    it('applies custom className', () => {
      const testClass = 'custom-test-class'
      const { container } = render(<VerticalLine className={testClass} />)
      const svg = container.querySelector('svg')
      expect(svg).toHaveClass(testClass)
    })
  })
})
