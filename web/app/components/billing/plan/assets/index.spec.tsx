import { render } from '@testing-library/react'
import EnterpriseDirect from './enterprise'

import { Enterprise, Professional, Sandbox, Team } from './index'
import ProfessionalDirect from './professional'
// Import real components for comparison
import SandboxDirect from './sandbox'
import TeamDirect from './team'

describe('Billing Plan Assets - Integration Tests', () => {
  describe('Exports', () => {
    it('should export Sandbox component', () => {
      expect(Sandbox).toBeDefined()
      // Sandbox is wrapped with React.memo, so it's an object
      expect(typeof Sandbox).toMatch(/function|object/)
    })

    it('should export Professional component', () => {
      expect(Professional).toBeDefined()
      expect(typeof Professional).toBe('function')
    })

    it('should export Team component', () => {
      expect(Team).toBeDefined()
      expect(typeof Team).toBe('function')
    })

    it('should export Enterprise component', () => {
      expect(Enterprise).toBeDefined()
      expect(typeof Enterprise).toBe('function')
    })

    it('should export all four components', () => {
      const exports = { Sandbox, Professional, Team, Enterprise }
      expect(Object.keys(exports)).toHaveLength(4)
    })
  })

  describe('Export Integrity', () => {
    it('should export the correct Sandbox component', () => {
      expect(Sandbox).toBe(SandboxDirect)
    })

    it('should export the correct Professional component', () => {
      expect(Professional).toBe(ProfessionalDirect)
    })

    it('should export the correct Team component', () => {
      expect(Team).toBe(TeamDirect)
    })

    it('should export the correct Enterprise component', () => {
      expect(Enterprise).toBe(EnterpriseDirect)
    })
  })

  describe('Rendering Integration', () => {
    it('should render all components without conflicts', () => {
      const { container } = render(
        <div>
          <Sandbox />
          <Professional />
          <Team />
          <Enterprise />
        </div>,
      )

      const svgs = container.querySelectorAll('svg')
      expect(svgs).toHaveLength(4)
    })

    it('should render Sandbox component correctly', () => {
      const { container } = render(<Sandbox />)
      const svg = container.querySelector('svg')

      expect(svg).toBeInTheDocument()
      expect(svg).toHaveAttribute('width', '32')
      expect(svg).toHaveAttribute('height', '32')
    })

    it('should render Professional component correctly', () => {
      const { container } = render(<Professional />)
      const svg = container.querySelector('svg')

      expect(svg).toBeInTheDocument()
      expect(svg).toHaveAttribute('width', '32')
      expect(svg).toHaveAttribute('height', '32')
    })

    it('should render Team component correctly', () => {
      const { container } = render(<Team />)
      const svg = container.querySelector('svg')

      expect(svg).toBeInTheDocument()
      expect(svg).toHaveAttribute('width', '32')
      expect(svg).toHaveAttribute('height', '32')
    })

    it('should render Enterprise component correctly', () => {
      const { container } = render(<Enterprise />)
      const svg = container.querySelector('svg')

      expect(svg).toBeInTheDocument()
      expect(svg).toHaveAttribute('width', '32')
      expect(svg).toHaveAttribute('height', '32')
    })
  })

  describe('Visual Consistency', () => {
    it('should maintain consistent SVG dimensions across all components', () => {
      const components = [
        <Sandbox key="sandbox" />,
        <Professional key="professional" />,
        <Team key="team" />,
        <Enterprise key="enterprise" />,
      ]

      components.forEach((component) => {
        const { container } = render(component)
        const svg = container.querySelector('svg')

        expect(svg).toHaveAttribute('width', '32')
        expect(svg).toHaveAttribute('height', '32')
        expect(svg).toHaveAttribute('viewBox', '0 0 32 32')
      })
    })

    it('should use consistent color variables across all components', () => {
      const components = [Sandbox, Professional, Team, Enterprise]

      components.forEach((Component) => {
        const { container } = render(<Component />)
        const elementsWithBlue = container.querySelectorAll('[fill="var(--color-saas-dify-blue-inverted)"]')
        const elementsWithQuaternary = container.querySelectorAll('[fill="var(--color-text-quaternary)"]')

        expect(elementsWithBlue.length).toBeGreaterThan(0)
        expect(elementsWithQuaternary.length).toBeGreaterThan(0)
      })
    })
  })

  describe('Component Independence', () => {
    it('should render components independently without side effects', () => {
      const { container: container1 } = render(<Sandbox />)
      const svg1 = container1.querySelector('svg')

      const { container: container2 } = render(<Professional />)
      const svg2 = container2.querySelector('svg')

      // Components should not affect each other
      expect(svg1).toBeInTheDocument()
      expect(svg2).toBeInTheDocument()
      expect(svg1).not.toBe(svg2)
    })

    it('should allow selective imports', () => {
      // Verify that importing only one component works
      const { container } = render(<Team />)
      const svg = container.querySelector('svg')

      expect(svg).toBeInTheDocument()
    })
  })

  describe('Bundle Export Pattern', () => {
    it('should follow barrel export pattern correctly', () => {
      // All exports should be available from the index
      expect(Sandbox).toBeDefined()
      expect(Professional).toBeDefined()
      expect(Team).toBeDefined()
      expect(Enterprise).toBeDefined()
    })

    it('should maintain tree-shaking compatibility', () => {
      // Each export should be independently usable
      const components = [Sandbox, Professional, Team, Enterprise]

      components.forEach((Component) => {
        // Component can be function or object (React.memo wraps it)
        expect(['function', 'object']).toContain(typeof Component)
        const { container } = render(<Component />)
        expect(container.querySelector('svg')).toBeInTheDocument()
      })
    })
  })

  describe('Real-world Usage Patterns', () => {
    it('should support rendering in a plan selector', () => {
      const { container } = render(
        <div className="plan-selector">
          <button className="plan-option">
            <Sandbox />
            <span>Sandbox</span>
          </button>
          <button className="plan-option">
            <Professional />
            <span>Professional</span>
          </button>
          <button className="plan-option">
            <Team />
            <span>Team</span>
          </button>
          <button className="plan-option">
            <Enterprise />
            <span>Enterprise</span>
          </button>
        </div>,
      )

      const svgs = container.querySelectorAll('svg')
      const buttons = container.querySelectorAll('button')

      expect(svgs).toHaveLength(4)
      expect(buttons).toHaveLength(4)
    })

    it('should support rendering in a comparison table', () => {
      const { container } = render(
        <table>
          <thead>
            <tr>
              <th><Sandbox /></th>
              <th><Professional /></th>
              <th><Team /></th>
              <th><Enterprise /></th>
            </tr>
          </thead>
        </table>,
      )

      const svgs = container.querySelectorAll('svg')
      expect(svgs).toHaveLength(4)
    })

    it('should support conditional rendering', () => {
      const renderPlan = (planType: 'sandbox' | 'professional' | 'team' | 'enterprise') => (
        <div>
          {planType === 'sandbox' && <Sandbox />}
          {planType === 'professional' && <Professional />}
          {planType === 'team' && <Team />}
          {planType === 'enterprise' && <Enterprise />}
        </div>
      )

      const { container } = render(renderPlan('team'))

      const svgs = container.querySelectorAll('svg')
      expect(svgs).toHaveLength(1)
    })

    it('should support dynamic rendering from array', () => {
      const plans = [
        { id: 'sandbox', Icon: Sandbox },
        { id: 'professional', Icon: Professional },
        { id: 'team', Icon: Team },
        { id: 'enterprise', Icon: Enterprise },
      ]

      const { container } = render(
        <div>
          {plans.map(({ id, Icon }) => (
            <div key={id}>
              <Icon />
            </div>
          ))}
        </div>,
      )

      const svgs = container.querySelectorAll('svg')
      expect(svgs).toHaveLength(4)
    })
  })

  describe('Performance', () => {
    it('should handle rapid re-renders efficiently', () => {
      const { container, rerender } = render(
        <div>
          <Sandbox />
          <Professional />
        </div>,
      )

      // Simulate multiple re-renders
      for (let i = 0; i < 5; i++) {
        rerender(
          <div>
            <Team />
            <Enterprise />
          </div>,
        )
      }

      const svgs = container.querySelectorAll('svg')
      expect(svgs).toHaveLength(2)
    })

    it('should handle large lists efficiently', () => {
      const { container } = render(
        <div>
          {Array.from({ length: 20 }).map((_, i) => {
            const components = [Sandbox, Professional, Team, Enterprise]
            const Component = components[i % 4]
            return <Component key={i} />
          })}
        </div>,
      )

      const svgs = container.querySelectorAll('svg')
      expect(svgs).toHaveLength(20)
    })
  })
})
