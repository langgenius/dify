import type { ModelProvider } from '../../declarations'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import QuotaPanel from '../quota-panel'

let mockWorkspaceData: {
  trial_credits: number
  trial_credits_used: number
  next_credit_reset_date: string
} | undefined = {
  trial_credits: 100,
  trial_credits_used: 30,
  next_credit_reset_date: '2024-12-31',
}
let mockWorkspaceIsPending = false
let mockTrialModels: string[] | undefined = ['langgenius/openai/openai']
let mockPlugins = [{
  plugin_id: 'langgenius/openai',
  latest_package_identifier: 'openai@1.0.0',
}]

vi.mock('@/app/components/base/icons/src/public/llm', () => {
  const Icon = ({ label }: { label: string }) => <span>{label}</span>
  return {
    OpenaiSmall: () => <Icon label="openai" />,
    AnthropicShortLight: () => <Icon label="anthropic" />,
    Gemini: () => <Icon label="gemini" />,
    Grok: () => <Icon label="x" />,
    Deepseek: () => <Icon label="deepseek" />,
    Tongyi: () => <Icon label="tongyi" />,
  }
})

vi.mock('@/service/use-common', () => ({
  useCurrentWorkspace: () => ({
    data: mockWorkspaceData,
    isPending: mockWorkspaceIsPending,
  }),
}))

vi.mock('@/context/global-public-context', () => ({
  useSystemFeaturesQuery: () => ({
    data: mockTrialModels ? { trial_models: mockTrialModels } : undefined,
  }),
}))

vi.mock('../../hooks', () => ({
  useMarketplaceAllPlugins: () => ({
    plugins: mockPlugins,
  }),
}))

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatTime: () => '2024-12-31',
  }),
}))

vi.mock('@/app/components/plugins/install-plugin/install-from-marketplace', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div>
      <span>install modal</span>
      <button type="button" onClick={onClose}>close install</button>
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
    mockWorkspaceData = {
      trial_credits: 100,
      trial_credits_used: 30,
      next_credit_reset_date: '2024-12-31',
    }
    mockWorkspaceIsPending = false
    mockTrialModels = ['langgenius/openai/openai']
    mockPlugins = [{ plugin_id: 'langgenius/openai', latest_package_identifier: 'openai@1.0.0' }]
  })

  it('should render loading state', () => {
    mockWorkspaceData = undefined
    mockWorkspaceIsPending = true

    render(<QuotaPanel providers={mockProviders} />)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('should show remaining credits and reset date', () => {
    render(
      <QuotaPanel
        providers={mockProviders}
      />,
    )

    expect(screen.getByText(/modelProvider\.quota/)).toBeInTheDocument()
    expect(screen.getByText('70')).toBeInTheDocument()
    expect(screen.getByText(/modelProvider\.resetDate/)).toBeInTheDocument()
  })

  it('should keep quota content during background refetch when cached workspace exists', () => {
    mockWorkspaceIsPending = true

    render(<QuotaPanel providers={mockProviders} />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByText('70')).toBeInTheDocument()
  })

  it('should floor credits at zero when usage is higher than quota', () => {
    mockWorkspaceData = {
      trial_credits: 10,
      trial_credits_used: 999,
      next_credit_reset_date: '',
    }

    render(<QuotaPanel providers={mockProviders} />)

    expect(screen.getByText(/modelProvider\.card\.quotaExhausted/)).toBeInTheDocument()
    expect(screen.queryByText(/modelProvider\.resetDate/)).not.toBeInTheDocument()
  })

  it('should open install modal when clicking an unsupported trial provider', () => {
    render(<QuotaPanel providers={[]} />)

    fireEvent.click(screen.getByText('openai'))

    expect(screen.getByText('install modal')).toBeInTheDocument()
  })

  it('should close install modal when provider becomes installed', async () => {
    const { rerender } = render(<QuotaPanel providers={[]} />)

    fireEvent.click(screen.getByText('openai'))
    expect(screen.getByText('install modal')).toBeInTheDocument()

    rerender(<QuotaPanel providers={mockProviders} />)

    await waitFor(() => {
      expect(screen.queryByText('install modal')).not.toBeInTheDocument()
    })
  })

  it('should tolerate missing trial model configuration', () => {
    mockTrialModels = undefined

    render(<QuotaPanel providers={mockProviders} />)

    expect(screen.queryByText('openai')).not.toBeInTheDocument()
  })

  it('should render installed custom providers without opening the install modal', () => {
    render(<QuotaPanel providers={mockProviders} />)

    expect(screen.getByLabelText(/modelAPI/)).toBeInTheDocument()

    fireEvent.click(screen.getByText('openai'))

    expect(screen.queryByText('install modal')).not.toBeInTheDocument()
  })

  it('should show the supported-model tooltip for installed non-custom providers', () => {
    render(
      <QuotaPanel providers={[
        {
          provider: 'langgenius/openai/openai',
          preferred_provider_type: 'system',
          custom_configuration: { available_credentials: [] },
        },
      ] as unknown as ModelProvider[]}
      />,
    )

    expect(screen.getByLabelText(/modelSupported/)).toBeInTheDocument()
  })
})
