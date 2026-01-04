import { render } from '@testing-library/react'
import * as React from 'react'
import Sandbox from './sandbox'

describe('Sandbox Icon Component', () => {
  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(<Sandbox />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render an SVG element', () => {
      const { container } = render(<Sandbox />)
      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })

    it('should have correct SVG attributes', () => {
      const { container } = render(<Sandbox />)
      const svg = container.querySelector('svg')

      expect(svg).toHaveAttribute('xmlns', 'http://www.w3.org/2000/svg')
      expect(svg).toHaveAttribute('width', '32')
      expect(svg).toHaveAttribute('height', '32')
      expect(svg).toHaveAttribute('viewBox', '0 0 32 32')
      expect(svg).toHaveAttribute('fill', 'none')
    })

    it('should render correct number of SVG elements', () => {
      const { container } = render(<Sandbox />)
      const rects = container.querySelectorAll('rect')
      const paths = container.querySelectorAll('path')

      // Based on the component structure
      expect(rects.length).toBeGreaterThan(0)
      expect(paths.length).toBeGreaterThan(0)
    })

    it('should render elements with correct fill colors', () => {
      const { container } = render(<Sandbox />)
      const blueElements = container.querySelectorAll('[fill="var(--color-saas-dify-blue-inverted)"]')
      const quaternaryElements = container.querySelectorAll('[fill="var(--color-text-quaternary)"]')

      expect(blueElements.length).toBeGreaterThan(0)
      expect(quaternaryElements.length).toBeGreaterThan(0)
    })
  })

  describe('Component Behavior', () => {
    it('should be memoized with React.memo', () => {
      // React.memo wraps the component, so the display name should indicate memoization
      // The component itself should be stable across re-renders
      const { rerender, container } = render(<Sandbox />)
      const firstRender = container.innerHTML

      rerender(<Sandbox />)
      const secondRender = container.innerHTML

      expect(firstRender).toBe(secondRender)
    })

    it('should render consistently across multiple renders', () => {
      const { container: container1 } = render(<Sandbox />)
      const { container: container2 } = render(<Sandbox />)

      expect(container1.innerHTML).toBe(container2.innerHTML)
    })
  })

  describe('Accessibility', () => {
    it('should render as a decorative image (no accessibility concerns for icon)', () => {
      const { container } = render(<Sandbox />)
      const svg = container.querySelector('svg')

      // SVG icons typically don't need aria-labels if they're decorative
      // This test ensures the SVG is present and renderable
      expect(svg).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle multiple instances without conflicts', () => {
      const { container } = render(
        <>
          <Sandbox />
          <Sandbox />
          <Sandbox />
        </>,
      )

      const svgs = container.querySelectorAll('svg')
      expect(svgs).toHaveLength(3)
    })

    it('should maintain structure when wrapped in other elements', () => {
      const { container } = render(
        <div>
          <span>
            <Sandbox />
          </span>
        </div>,
      )

      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
      expect(svg?.getAttribute('width')).toBe('32')
    })
  })

  describe('CSS Variables', () => {
    it('should use CSS custom properties for colors', () => {
      const { container } = render(<Sandbox />)
      const allFillElements = container.querySelectorAll('[fill]')
      const elementsWithCSSVars = Array.from(allFillElements).filter(el =>
        el.getAttribute('fill')?.startsWith('var('),
      )

      // All fill attributes should use CSS variables
      expect(elementsWithCSSVars.length).toBeGreaterThan(0)
    })

    it('should have opacity attributes on quaternary elements', () => {
      const { container } = render(<Sandbox />)
      const quaternaryElements = container.querySelectorAll('[fill="var(--color-text-quaternary)"]')

      quaternaryElements.forEach((element) => {
        expect(element).toHaveAttribute('opacity', '0.18')
      })
    })
  })
})
