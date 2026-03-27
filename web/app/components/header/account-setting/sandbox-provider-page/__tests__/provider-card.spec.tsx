import type { SandboxProvider } from '@/types/sandbox-provider'
import { fireEvent, render, screen } from '@testing-library/react'
import ProviderCard from '../provider-card'

const createProvider = (overrides: Partial<SandboxProvider> = {}): SandboxProvider => ({
  provider_type: 'e2b',
  is_system_configured: false,
  is_tenant_configured: true,
  is_active: false,
  config: {},
  config_schema: [],
  ...overrides,
})

describe('Sandbox ProviderCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Covers the current-provider presentation path.
  describe('current provider', () => {
    it('should render the connected state and config action for the active provider', () => {
      const onConfig = vi.fn()
      const { container } = render(
        <ProviderCard
          provider={createProvider({ is_active: true })}
          isCurrent
          onConfig={onConfig}
        />,
      )

      expect(screen.getByText('E2B')).toBeInTheDocument()
      expect(screen.getByText('common.sandboxProvider.connected')).toBeInTheDocument()
      expect(screen.queryByText('common.sandboxProvider.setAsActive')).not.toBeInTheDocument()

      const buttons = container.querySelectorAll('button')
      expect(buttons).toHaveLength(1)
      fireEvent.click(buttons[0])
      expect(onConfig).toHaveBeenCalledTimes(1)
    })
  })

  // Covers action availability for other configured providers.
  describe('other providers', () => {
    it('should render enable and config actions when the provider is configured', () => {
      const onConfig = vi.fn()
      const onEnable = vi.fn()
      const { container } = render(
        <ProviderCard
          provider={createProvider()}
          onConfig={onConfig}
          onEnable={onEnable}
        />,
      )

      expect(screen.getByText('common.sandboxProvider.setAsActive')).toBeInTheDocument()

      const buttons = container.querySelectorAll('button')
      expect(buttons).toHaveLength(2)

      fireEvent.click(buttons[0])
      fireEvent.click(buttons[1])

      expect(onEnable).toHaveBeenCalledTimes(1)
      expect(onConfig).toHaveBeenCalledTimes(1)
    })

    it('should hide actions when the card is disabled', () => {
      const { container } = render(
        <ProviderCard
          provider={createProvider()}
          onConfig={vi.fn()}
          onEnable={vi.fn()}
          disabled
        />,
      )

      expect(screen.queryByText('common.sandboxProvider.setAsActive')).not.toBeInTheDocument()
      expect(container.querySelectorAll('button')).toHaveLength(0)
    })
  })
})
