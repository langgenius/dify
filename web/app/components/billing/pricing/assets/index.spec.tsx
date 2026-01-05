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
} from './index'

describe('Pricing Assets', () => {
  // Rendering: each asset should render an svg.
  describe('Rendering', () => {
    it('should render static assets without crashing', () => {
      // Arrange
      const assets = [
        <Community key="community" />,
        <Enterprise key="enterprise" />,
        <EnterpriseNoise key="enterprise-noise" />,
        <NoiseBottom key="noise-bottom" />,
        <NoiseTop key="noise-top" />,
        <Premium key="premium" />,
        <PremiumNoise key="premium-noise" />,
        <Professional key="professional" />,
        <Sandbox key="sandbox" />,
        <Team key="team" />,
      ]

      // Act / Assert
      assets.forEach((asset) => {
        const { container, unmount } = render(asset)
        expect(container.querySelector('svg')).toBeInTheDocument()
        unmount()
      })
    })
  })

  // Props: active state should change fill color for selectable assets.
  describe('Props', () => {
    it('should render active state for Cloud', () => {
      // Arrange
      const { container } = render(<Cloud isActive />)

      // Assert
      const rects = Array.from(container.querySelectorAll('rect'))
      expect(rects.some(rect => rect.getAttribute('fill') === 'var(--color-saas-dify-blue-accessible)')).toBe(true)
    })

    it('should render inactive state for SelfHosted', () => {
      // Arrange
      const { container } = render(<SelfHosted isActive={false} />)

      // Assert
      const rects = Array.from(container.querySelectorAll('rect'))
      expect(rects.some(rect => rect.getAttribute('fill') === 'var(--color-text-primary)')).toBe(true)
    })
  })
})
