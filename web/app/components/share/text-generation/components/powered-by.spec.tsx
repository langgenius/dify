import { render, screen } from '@testing-library/react'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { defaultSystemFeatures } from '@/types/feature'
import PoweredBy from './powered-by'

// Helper to override branding in system features while keeping other defaults
const setBranding = (branding: Partial<typeof defaultSystemFeatures.branding>) => {
  useGlobalPublicStore.setState({
    systemFeatures: {
      ...defaultSystemFeatures,
      branding: { ...defaultSystemFeatures.branding, ...branding },
    },
  })
}

describe('PoweredBy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Renders default Dify logo
  describe('Default rendering', () => {
    it('should render powered-by text', () => {
      render(<PoweredBy isPC={true} resultExisted={false} customConfig={null} />)

      expect(screen.getByText(/share\.chat\.poweredBy/)).toBeInTheDocument()
    })
  })

  // Branding logo
  describe('Custom branding', () => {
    it('should render workspace logo when branding is enabled', () => {
      setBranding({ enabled: true, workspace_logo: 'https://example.com/logo.png' })

      render(<PoweredBy isPC={true} resultExisted={false} customConfig={null} />)

      const img = screen.getByAltText('logo')
      expect(img).toHaveAttribute('src', 'https://example.com/logo.png')
    })

    it('should render custom logo from customConfig', () => {
      render(
        <PoweredBy
          isPC={true}
          resultExisted={false}
          customConfig={{ replace_webapp_logo: 'https://custom.com/logo.png' }}
        />,
      )

      const img = screen.getByAltText('logo')
      expect(img).toHaveAttribute('src', 'https://custom.com/logo.png')
    })

    it('should prefer branding logo over custom config logo', () => {
      setBranding({ enabled: true, workspace_logo: 'https://brand.com/logo.png' })

      render(
        <PoweredBy
          isPC={true}
          resultExisted={false}
          customConfig={{ replace_webapp_logo: 'https://custom.com/logo.png' }}
        />,
      )

      const img = screen.getByAltText('logo')
      expect(img).toHaveAttribute('src', 'https://brand.com/logo.png')
    })
  })

  // Hidden when remove_webapp_brand
  describe('Visibility', () => {
    it('should return null when remove_webapp_brand is truthy', () => {
      const { container } = render(
        <PoweredBy
          isPC={true}
          resultExisted={false}
          customConfig={{ remove_webapp_brand: true }}
        />,
      )

      expect(container.innerHTML).toBe('')
    })

    it('should render when remove_webapp_brand is falsy', () => {
      const { container } = render(
        <PoweredBy
          isPC={true}
          resultExisted={false}
          customConfig={{ remove_webapp_brand: false }}
        />,
      )

      expect(container.innerHTML).not.toBe('')
    })
  })
})
