import { render } from '@testing-library/react'
import * as React from 'react'
import HorizontalLine from './horizontal-line'

describe('HorizontalLine', () => {
  describe('Render', () => {
    it('renders correctly', () => {
      const { container } = render(<HorizontalLine />)
      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
      expect(svg).toHaveAttribute('width', '240')
      expect(svg).toHaveAttribute('height', '2')
    })

    it('renders linear gradient definition', () => {
      const { container } = render(<HorizontalLine />)
      const defs = container.querySelector('defs')
      const linearGradient = container.querySelector('linearGradient')
      expect(defs).toBeInTheDocument()
      expect(linearGradient).toBeInTheDocument()
      expect(linearGradient).toHaveAttribute('id', 'paint0_linear_8619_59125')
    })
  })

  describe('Style', () => {
    it('applies custom className', () => {
      const testClass = 'custom-test-class'
      const { container } = render(<HorizontalLine className={testClass} />)
      const svg = container.querySelector('svg')
      expect(svg).toHaveClass(testClass)
    })
  })
})
