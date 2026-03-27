import { render } from '@testing-library/react'
import ProviderIcon from '../provider-icon'

describe('Sandbox ProviderIcon', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Covers built-in branded render paths.
  describe('built-in providers', () => {
    it('should render docker with border wrapper and svg icon', () => {
      const { container } = render(<ProviderIcon providerType="docker" withBorder />)

      expect(container.querySelector('svg')).toBeInTheDocument()
      expect(container.firstElementChild).toHaveClass('rounded')
    })

    it('should render ssh with the dedicated image asset', () => {
      const { getByAltText } = render(<ProviderIcon providerType="ssh" />)

      expect(getByAltText('ssh icon')).toHaveAttribute('src', '/sandbox-providers/ssh.svg')
    })

    it('should render local and ssh providers with bordered wrappers', () => {
      const local = render(<ProviderIcon providerType="local" withBorder size="sm" />)

      expect(local.container.querySelector('svg')).toBeInTheDocument()
      expect(local.container.firstElementChild).toHaveClass('rounded')

      local.unmount()

      const ssh = render(<ProviderIcon providerType="ssh" withBorder />)

      expect(ssh.getByAltText('ssh icon')).toHaveAttribute('src', '/sandbox-providers/ssh.svg')
      expect(ssh.container.firstElementChild).toHaveClass('rounded')
    })
  })

  // Covers the fallback icon path for unknown providers.
  describe('fallback providers', () => {
    it('should fall back to the configured icon asset for unknown providers', () => {
      const { getByAltText } = render(<ProviderIcon providerType="unknown-provider" size="sm" />)

      expect(getByAltText('unknown-provider icon')).toHaveAttribute('src', '/sandbox-providers/e2b.svg')
    })

    it('should wrap fallback icons in a border when requested', () => {
      const { container, getByAltText } = render(<ProviderIcon providerType="custom-provider" withBorder />)

      expect(getByAltText('custom-provider icon')).toHaveAttribute('src', '/sandbox-providers/e2b.svg')
      expect(container.firstElementChild).toHaveClass('rounded')
    })
  })
})
