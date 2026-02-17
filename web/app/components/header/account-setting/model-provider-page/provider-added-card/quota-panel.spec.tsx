import type { ModelProvider } from '../declarations'
import { render, screen } from '@testing-library/react'
import QuotaPanel from './quota-panel'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { modelNames?: string }) => `${_key}${options?.modelNames ? `:${options.modelNames}` : ''}`,
  }),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    currentWorkspace: {
      trial_credits: 100,
      trial_credits_used: 30,
      next_credit_reset_date: '2024-12-31',
    },
  }),
}))

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: (selector: (state: unknown) => unknown) => selector({
    systemFeatures: {
      trial_models: [],
    },
  }),
}))

vi.mock('../hooks', () => ({
  useMarketplaceAllPlugins: () => ({
    plugins: [],
  }),
}))

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatTime: (_date: string, _format: string) => '2024-12-31',
  }),
}))

vi.mock('@/app/components/plugins/install-plugin/install-from-marketplace', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="install-modal">
      <button onClick={onClose}>Close</button>
    </div>
  ),
}))

describe('QuotaPanel', () => {
  const mockProviders = [
    {
      provider: 'langgenius/openai/openai',
      preferred_provider_type: 'custom',
      custom_configuration: { available_credentials: [{ id: '1' }] },
    },
  ] as unknown as ModelProvider[]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render loading state when isLoading is true', () => {
    render(
      <QuotaPanel
        providers={mockProviders}
        isLoading={true}
      />,
    )
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('should display quota credits when not loading', () => {
    render(
      <QuotaPanel
        providers={mockProviders}
        isLoading={false}
      />,
    )
    expect(screen.getByText(/modelProvider.quota/)).toBeInTheDocument()
    expect(screen.getByText(/70/)).toBeInTheDocument()
  })

  it('should display reset date when available', () => {
    render(
      <QuotaPanel
        providers={mockProviders}
        isLoading={false}
      />,
    )
    expect(screen.getByText(/modelProvider.resetDate/)).toBeInTheDocument()
  })
})
