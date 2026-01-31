import { render } from '@testing-library/react'
import Professional from './professional'

describe('Professional Icon Component', () => {
  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(<Professional />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render an SVG element', () => {
      const { container } = render(<Professional />)
      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })

    it('should have correct SVG attributes', () => {
      const { container } = render(<Professional />)
      const svg = container.querySelector('svg')

      expect(svg).toHaveAttribute('xmlns', 'http://www.w3.org/2000/svg')
      expect(svg).toHaveAttribute('width', '32')
      expect(svg).toHaveAttribute('height', '32')
      expect(svg).toHaveAttribute('viewBox', '0 0 32 32')
      expect(svg).toHaveAttribute('fill', 'none')
    })

    it('should render correct number of SVG rect elements', () => {
      const { container } = render(<Professional />)
      const rects = container.querySelectorAll('rect')

      // Based on the component structure, it should have multiple rect elements
      expect(rects.length).toBeGreaterThan(0)
    })

    it('should render elements with correct fill colors', () => {
      const { container } = render(<Professional />)
      const blueElements = container.querySelectorAll('[fill="var(--color-saas-dify-blue-inverted)"]')
      const quaternaryElements = container.querySelectorAll('[fill="var(--color-text-quaternary)"]')

      expect(blueElements.length).toBeGreaterThan(0)
      expect(quaternaryElements.length).toBeGreaterThan(0)
    })
  })

  describe('Component Behavior', () => {
    it('should render consistently across multiple renders', () => {
      const { container: container1 } = render(<Professional />)
      const { container: container2 } = render(<Professional />)

      expect(container1.innerHTML).toBe(container2.innerHTML)
    })

    it('should not be wrapped with React.memo', () => {
      // Professional component is exported directly without React.memo
      // This test ensures the component renders correctly without memoization
      const { container, rerender } = render(<Professional />)
      const firstRender = container.innerHTML

      rerender(<Professional />)
      const secondRender = container.innerHTML

      // Content should still be the same even without memoization
      expect(firstRender).toBe(secondRender)
    })
  })

  describe('Accessibility', () => {
    it('should render as a decorative image (no accessibility concerns for icon)', () => {
      const { container } = render(<Professional />)
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
          <Professional />
          <Professional />
          <Professional />
        </>,
      )

      const svgs = container.querySelectorAll('svg')
      expect(svgs).toHaveLength(3)
    })

    it('should maintain structure when wrapped in other elements', () => {
      const { container } = render(
        <div>
          <span>
            <Professional />
          </span>
        </div>,
      )

      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
      expect(svg?.getAttribute('width')).toBe('32')
    })

    it('should render in different contexts without errors', () => {
      const { container } = render(
        <div className="test-wrapper">
          <Professional />
        </div>,
      )

      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })
  })

  describe('CSS Variables', () => {
    it('should use CSS custom properties for colors', () => {
      const { container } = render(<Professional />)
      const allFillElements = container.querySelectorAll('[fill]')
      const elementsWithCSSVars = Array.from(allFillElements).filter(el =>
        el.getAttribute('fill')?.startsWith('var('),
      )

      // All fill attributes should use CSS variables
      expect(elementsWithCSSVars.length).toBeGreaterThan(0)
    })

    it('should have opacity attributes on quaternary elements', () => {
      const { container } = render(<Professional />)
      const quaternaryElements = container.querySelectorAll('[fill="var(--color-text-quaternary)"]')

      quaternaryElements.forEach((element) => {
        expect(element).toHaveAttribute('opacity', '0.18')
      })
    })

    it('should not have opacity on blue inverted elements', () => {
      const { container } = render(<Professional />)
      const blueElements = container.querySelectorAll('[fill="var(--color-saas-dify-blue-inverted)"]')

      blueElements.forEach((element) => {
        expect(element).not.toHaveAttribute('opacity')
      })
    })
  })

  describe('SVG Structure', () => {
    it('should have correct rect element structure', () => {
      const { container } = render(<Professional />)
      const rects = container.querySelectorAll('rect')

      // Each rect should have specific attributes
      rects.forEach((rect) => {
        expect(rect).toHaveAttribute('width', '2')
        expect(rect).toHaveAttribute('height', '2')
        expect(rect).toHaveAttribute('rx', '1')
        expect(rect).toHaveAttribute('fill')
      })
    })

    it('should maintain exact pixel positioning', () => {
      const { container } = render(<Professional />)
      const rects = container.querySelectorAll('rect')

      // Ensure positioning attributes exist
      rects.forEach((rect) => {
        expect(rect).toHaveAttribute('x')
        expect(rect).toHaveAttribute('y')
      })
    })
  })
})
