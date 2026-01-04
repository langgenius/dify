import { render } from '@testing-library/react'
import Enterprise from './enterprise'

describe('Enterprise Icon Component', () => {
  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(<Enterprise />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render an SVG element', () => {
      const { container } = render(<Enterprise />)
      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })

    it('should have correct SVG attributes', () => {
      const { container } = render(<Enterprise />)
      const svg = container.querySelector('svg')

      expect(svg).toHaveAttribute('xmlns', 'http://www.w3.org/2000/svg')
      expect(svg).toHaveAttribute('width', '32')
      expect(svg).toHaveAttribute('height', '32')
      expect(svg).toHaveAttribute('viewBox', '0 0 32 32')
      expect(svg).toHaveAttribute('fill', 'none')
    })

    it('should render only path elements', () => {
      const { container } = render(<Enterprise />)
      const paths = container.querySelectorAll('path')
      const rects = container.querySelectorAll('rect')

      // Enterprise icon uses only path elements, no rects
      expect(paths.length).toBeGreaterThan(0)
      expect(rects).toHaveLength(0)
    })

    it('should render elements with correct fill colors', () => {
      const { container } = render(<Enterprise />)
      const blueElements = container.querySelectorAll('[fill="var(--color-saas-dify-blue-inverted)"]')
      const quaternaryElements = container.querySelectorAll('[fill="var(--color-text-quaternary)"]')

      expect(blueElements.length).toBeGreaterThan(0)
      expect(quaternaryElements.length).toBeGreaterThan(0)
    })
  })

  describe('Component Behavior', () => {
    it('should render consistently across multiple renders', () => {
      const { container: container1 } = render(<Enterprise />)
      const { container: container2 } = render(<Enterprise />)

      expect(container1.innerHTML).toBe(container2.innerHTML)
    })

    it('should maintain stable output without memoization', () => {
      const { container, rerender } = render(<Enterprise />)
      const firstRender = container.innerHTML

      rerender(<Enterprise />)
      const secondRender = container.innerHTML

      expect(firstRender).toBe(secondRender)
    })

    it('should be a functional component', () => {
      expect(typeof Enterprise).toBe('function')
    })
  })

  describe('Accessibility', () => {
    it('should render as a decorative image', () => {
      const { container } = render(<Enterprise />)
      const svg = container.querySelector('svg')

      expect(svg).toBeInTheDocument()
    })

    it('should be usable in accessible contexts', () => {
      const { container } = render(
        <div role="img" aria-label="Enterprise plan">
          <Enterprise />
        </div>,
      )

      const wrapper = container.querySelector('[role="img"]')
      expect(wrapper).toBeInTheDocument()
      expect(wrapper).toHaveAttribute('aria-label', 'Enterprise plan')
    })

    it('should support custom wrapper accessibility', () => {
      const { container } = render(
        <button aria-label="Select Enterprise plan">
          <Enterprise />
        </button>,
      )

      const button = container.querySelector('button')
      expect(button).toHaveAttribute('aria-label', 'Select Enterprise plan')
    })
  })

  describe('Edge Cases', () => {
    it('should handle multiple instances without conflicts', () => {
      const { container } = render(
        <>
          <Enterprise />
          <Enterprise />
          <Enterprise />
        </>,
      )

      const svgs = container.querySelectorAll('svg')
      expect(svgs).toHaveLength(3)
    })

    it('should maintain structure when wrapped in other elements', () => {
      const { container } = render(
        <div>
          <span>
            <Enterprise />
          </span>
        </div>,
      )

      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
      expect(svg?.getAttribute('width')).toBe('32')
    })

    it('should render correctly in grid layout', () => {
      const { container } = render(
        <div style={{ display: 'grid' }}>
          <Enterprise />
        </div>,
      )

      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })

    it('should render correctly in flex layout', () => {
      const { container } = render(
        <div style={{ display: 'flex' }}>
          <Enterprise />
        </div>,
      )

      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })
  })

  describe('CSS Variables', () => {
    it('should use CSS custom properties for colors', () => {
      const { container } = render(<Enterprise />)
      const allFillElements = container.querySelectorAll('[fill]')
      const elementsWithCSSVars = Array.from(allFillElements).filter(el =>
        el.getAttribute('fill')?.startsWith('var('),
      )

      expect(elementsWithCSSVars.length).toBeGreaterThan(0)
    })

    it('should have opacity attributes on quaternary path elements', () => {
      const { container } = render(<Enterprise />)
      const quaternaryPaths = container.querySelectorAll('path[fill="var(--color-text-quaternary)"]')

      quaternaryPaths.forEach((path) => {
        expect(path).toHaveAttribute('opacity', '0.18')
      })
    })

    it('should not have opacity on blue inverted path elements', () => {
      const { container } = render(<Enterprise />)
      const bluePaths = container.querySelectorAll('path[fill="var(--color-saas-dify-blue-inverted)"]')

      bluePaths.forEach((path) => {
        expect(path).not.toHaveAttribute('opacity')
      })
    })

    it('should use correct CSS variable names', () => {
      const { container } = render(<Enterprise />)
      const paths = container.querySelectorAll('path')

      paths.forEach((path) => {
        const fill = path.getAttribute('fill')
        if (fill?.includes('var('))
          expect(fill).toMatch(/var\(--(color-saas-dify-blue-inverted|color-text-quaternary)\)/)
      })
    })
  })

  describe('SVG Structure', () => {
    it('should have correct path element structure', () => {
      const { container } = render(<Enterprise />)
      const paths = container.querySelectorAll('path')

      paths.forEach((path) => {
        expect(path).toHaveAttribute('d')
        expect(path).toHaveAttribute('fill')
      })
    })

    it('should have valid path data', () => {
      const { container } = render(<Enterprise />)
      const paths = container.querySelectorAll('path')

      paths.forEach((path) => {
        const d = path.getAttribute('d')
        expect(d).toBeTruthy()
        expect(d?.length).toBeGreaterThan(0)
      })
    })

    it('should maintain proper element count', () => {
      const { container } = render(<Enterprise />)
      const svg = container.querySelector('svg')

      expect(svg?.childNodes.length).toBeGreaterThan(0)
    })
  })

  describe('Export', () => {
    it('should be the default export', () => {
      expect(Enterprise).toBeDefined()
      expect(typeof Enterprise).toBe('function')
    })

    it('should return valid JSX', () => {
      const result = Enterprise()
      expect(result).toBeTruthy()
      expect(result.type).toBe('svg')
    })
  })

  describe('Performance', () => {
    it('should render efficiently for multiple instances', () => {
      const { container } = render(
        <div>
          {Array.from({ length: 10 }).map((_, i) => (
            <Enterprise key={i} />
          ))}
        </div>,
      )

      const svgs = container.querySelectorAll('svg')
      expect(svgs).toHaveLength(10)
    })
  })
})
