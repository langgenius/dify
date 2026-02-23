import { render } from '@testing-library/react'
import {
  Cloud,
  Community,
  Enterprise,
  EnterpriseNoise,
  NoiseBottom,
  NoiseTop,
  Premium,
  PremiumNoise,
  Professional,
  Sandbox,
  SelfHosted,
  Team,
} from '../index'

// Static SVG components (no props)
describe('Static Pricing Asset Components', () => {
  const staticComponents = [
    { name: 'Community', Component: Community },
    { name: 'Enterprise', Component: Enterprise },
    { name: 'EnterpriseNoise', Component: EnterpriseNoise },
    { name: 'NoiseBottom', Component: NoiseBottom },
    { name: 'NoiseTop', Component: NoiseTop },
    { name: 'Premium', Component: Premium },
    { name: 'PremiumNoise', Component: PremiumNoise },
    { name: 'Professional', Component: Professional },
    { name: 'Sandbox', Component: Sandbox },
    { name: 'Team', Component: Team },
  ]

  it.each(staticComponents)('$name should render an SVG element', ({ Component }) => {
    const { container } = render(<Component />)
    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  it.each(staticComponents)('$name should render without errors on rerender', ({ Component }) => {
    const { container, rerender } = render(<Component />)
    rerender(<Component />)
    expect(container.querySelector('svg')).toBeInTheDocument()
  })
})

// Interactive SVG components with isActive prop
describe('Cloud', () => {
  it('should render an SVG element', () => {
    const { container } = render(<Cloud isActive={false} />)
    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  it('should use primary color when inactive', () => {
    const { container } = render(<Cloud isActive={false} />)
    const rects = container.querySelectorAll('rect[fill="var(--color-text-primary)"]')
    expect(rects.length).toBeGreaterThan(0)
  })

  it('should use accent color when active', () => {
    const { container } = render(<Cloud isActive={true} />)
    const rects = container.querySelectorAll('rect[fill="var(--color-saas-dify-blue-accessible)"]')
    expect(rects.length).toBeGreaterThan(0)
  })
})

describe('SelfHosted', () => {
  it('should render an SVG element', () => {
    const { container } = render(<SelfHosted isActive={false} />)
    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  it('should use primary color when inactive', () => {
    const { container } = render(<SelfHosted isActive={false} />)
    const rects = container.querySelectorAll('rect[fill="var(--color-text-primary)"]')
    expect(rects.length).toBeGreaterThan(0)
  })

  it('should use accent color when active', () => {
    const { container } = render(<SelfHosted isActive={true} />)
    const rects = container.querySelectorAll('rect[fill="var(--color-saas-dify-blue-accessible)"]')
    expect(rects.length).toBeGreaterThan(0)
  })
})
