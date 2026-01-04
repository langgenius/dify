import { render } from '@testing-library/react'
import Team from './team'

describe('Team Icon Component', () => {
  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(<Team />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render an SVG element', () => {
      const { container } = render(<Team />)
      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })

    it('should have correct SVG attributes', () => {
      const { container } = render(<Team />)
      const svg = container.querySelector('svg')

      expect(svg).toHaveAttribute('xmlns', 'http://www.w3.org/2000/svg')
      expect(svg).toHaveAttribute('width', '32')
      expect(svg).toHaveAttribute('height', '32')
      expect(svg).toHaveAttribute('viewBox', '0 0 32 32')
      expect(svg).toHaveAttribute('fill', 'none')
    })

    it('should render both rect and path elements', () => {
      const { container } = render(<Team />)
      const rects = container.querySelectorAll('rect')
      const paths = container.querySelectorAll('path')

      // Team icon uses both rects and paths
      expect(rects.length).toBeGreaterThan(0)
      expect(paths.length).toBeGreaterThan(0)
    })

    it('should render elements with correct fill colors', () => {
      const { container } = render(<Team />)
      const blueElements = container.querySelectorAll('[fill="var(--color-saas-dify-blue-inverted)"]')
      const quaternaryElements = container.querySelectorAll('[fill="var(--color-text-quaternary)"]')

      expect(blueElements.length).toBeGreaterThan(0)
      expect(quaternaryElements.length).toBeGreaterThan(0)
    })
  })

  describe('Component Behavior', () => {
    it('should render consistently across multiple renders', () => {
      const { container: container1 } = render(<Team />)
      const { container: container2 } = render(<Team />)

      expect(container1.innerHTML).toBe(container2.innerHTML)
    })

    it('should maintain stable output without memoization', () => {
      const { container, rerender } = render(<Team />)
      const firstRender = container.innerHTML

      rerender(<Team />)
      const secondRender = container.innerHTML

      expect(firstRender).toBe(secondRender)
    })
  })

  describe('Accessibility', () => {
    it('should render as a decorative image', () => {
      const { container } = render(<Team />)
      const svg = container.querySelector('svg')

      expect(svg).toBeInTheDocument()
    })

    it('should be usable in accessible contexts', () => {
      const { container } = render(
        <div role="img" aria-label="Team plan">
          <Team />
        </div>,
      )

      const wrapper = container.querySelector('[role="img"]')
      expect(wrapper).toBeInTheDocument()
      expect(wrapper).toHaveAttribute('aria-label', 'Team plan')
    })
  })

  describe('Edge Cases', () => {
    it('should handle multiple instances without conflicts', () => {
      const { container } = render(
        <>
          <Team />
          <Team />
          <Team />
        </>,
      )

      const svgs = container.querySelectorAll('svg')
      expect(svgs).toHaveLength(3)
    })

    it('should maintain structure when wrapped in other elements', () => {
      const { container } = render(
        <div>
          <span>
            <Team />
          </span>
        </div>,
      )

      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
      expect(svg?.getAttribute('width')).toBe('32')
    })

    it('should render correctly in list context', () => {
      const { container } = render(
        <ul>
          <li>
            <Team />
          </li>
          <li>
            <Team />
          </li>
        </ul>,
      )

      const svgs = container.querySelectorAll('svg')
      expect(svgs).toHaveLength(2)
    })
  })

  describe('CSS Variables', () => {
    it('should use CSS custom properties for colors', () => {
      const { container } = render(<Team />)
      const allFillElements = container.querySelectorAll('[fill]')
      const elementsWithCSSVars = Array.from(allFillElements).filter(el =>
        el.getAttribute('fill')?.startsWith('var('),
      )

      expect(elementsWithCSSVars.length).toBeGreaterThan(0)
    })

    it('should have opacity attributes on quaternary path elements', () => {
      const { container } = render(<Team />)
      const quaternaryPaths = container.querySelectorAll('path[fill="var(--color-text-quaternary)"]')

      quaternaryPaths.forEach((path) => {
        expect(path).toHaveAttribute('opacity', '0.18')
      })
    })

    it('should not have opacity on blue inverted elements', () => {
      const { container } = render(<Team />)
      const blueRects = container.querySelectorAll('rect[fill="var(--color-saas-dify-blue-inverted)"]')

      blueRects.forEach((rect) => {
        expect(rect).not.toHaveAttribute('opacity')
      })
    })
  })

  describe('SVG Structure', () => {
    it('should have correct rect element attributes', () => {
      const { container } = render(<Team />)
      const rects = container.querySelectorAll('rect')

      rects.forEach((rect) => {
        expect(rect).toHaveAttribute('x')
        expect(rect).toHaveAttribute('y')
        expect(rect).toHaveAttribute('width', '2')
        expect(rect).toHaveAttribute('height', '2')
        expect(rect).toHaveAttribute('rx', '1')
        expect(rect).toHaveAttribute('fill')
      })
    })

    it('should have correct path element structure', () => {
      const { container } = render(<Team />)
      const paths = container.querySelectorAll('path')

      paths.forEach((path) => {
        expect(path).toHaveAttribute('d')
        expect(path).toHaveAttribute('fill')
      })
    })

    it('should maintain proper element positioning', () => {
      const { container } = render(<Team />)
      const svg = container.querySelector('svg')

      expect(svg?.childNodes.length).toBeGreaterThan(0)
    })
  })

  describe('Export', () => {
    it('should be the default export', () => {
      expect(Team).toBeDefined()
      expect(typeof Team).toBe('function')
    })
  })
})
