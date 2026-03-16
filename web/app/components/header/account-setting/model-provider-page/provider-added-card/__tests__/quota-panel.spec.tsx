import type { ModelProvider } from '../../declarations'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import QuotaPanel from '../quota-panel'

let mockWorkspace = {
  trial_credits: 100,
  trial_credits_used: 30,
  next_credit_reset_date: '2024-12-31',
}
let mockTrialModels: string[] = ['langgenius/openai/openai']
let mockPlugins = [{
  plugin_id: 'langgenius/openai',
  latest_package_identifier: 'openai@1.0.0',
}]

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    currentWorkspace: mockWorkspace,
  }),
}))

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: (selector: (state: { systemFeatures: { trial_models: string[] } }) => unknown) => selector({
    systemFeatures: {
      trial_models: mockTrialModels,
    },
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
    mockWorkspace = {
      trial_credits: 100,
      trial_credits_used: 30,
      next_credit_reset_date: '2024-12-31',
    }
    mockTrialModels = ['langgenius/openai/openai']
    mockPlugins = [{ plugin_id: 'langgenius/openai', latest_package_identifier: 'openai@1.0.0' }]
  })

  const getTrialProviderIconTrigger = (container: HTMLElement) => {
    const providerIcon = container.querySelector('svg.h-6.w-6.rounded-lg')
    expect(providerIcon).toBeInTheDocument()
    const trigger = providerIcon?.closest('[data-state]') as HTMLDivElement | null
    expect(trigger).toBeInTheDocument()
    return trigger as HTMLDivElement
  }

  const clickFirstTrialProviderIcon = (container: HTMLElement) => {
    fireEvent.click(getTrialProviderIconTrigger(container))
  }

  it('should render loading state', () => {
    render(
      <QuotaPanel
        providers={mockProviders}
        isLoading
      />,
    )
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

  it('should floor credits at zero when usage is higher than quota', () => {
    mockWorkspace = {
      trial_credits: 10,
      trial_credits_used: 999,
      next_credit_reset_date: '',
    }

    render(<QuotaPanel providers={mockProviders} />)

    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.queryByText(/modelProvider\.resetDate/)).not.toBeInTheDocument()
  })

  it('should open install modal when clicking an unsupported trial provider', () => {
    const { container } = render(<QuotaPanel providers={[]} />)

    clickFirstTrialProviderIcon(container)

    expect(screen.getByText('install modal')).toBeInTheDocument()
  })

  it('should close install modal when provider becomes installed', async () => {
    const { rerender, container } = render(<QuotaPanel providers={[]} />)

    clickFirstTrialProviderIcon(container)
    expect(screen.getByText('install modal')).toBeInTheDocument()

    rerender(<QuotaPanel providers={mockProviders} />)

    await waitFor(() => {
      expect(screen.queryByText('install modal')).not.toBeInTheDocument()
    })
  })

  it('should not open install modal when clicking an already installed provider', () => {
    const { container } = render(<QuotaPanel providers={mockProviders} />)

    clickFirstTrialProviderIcon(container)

    expect(screen.queryByText('install modal')).not.toBeInTheDocument()
  })

  it('should not open install modal when plugin is not found in marketplace', () => {
    mockPlugins = []
    const { container } = render(<QuotaPanel providers={[]} />)

    clickFirstTrialProviderIcon(container)

    expect(screen.queryByText('install modal')).not.toBeInTheDocument()
  })

  it('should show destructive border when credits are zero or negative', () => {
    mockWorkspace = {
      trial_credits: 0,
      trial_credits_used: 0,
      next_credit_reset_date: '',
    }

    const { container } = render(<QuotaPanel providers={mockProviders} />)

    expect(container.querySelector('.border-state-destructive-border')).toBeInTheDocument()
  })

  it('should show modelAPI tooltip for configured provider with custom preference', async () => {
    const user = userEvent.setup()
    const { container } = render(<QuotaPanel providers={mockProviders} />)

    const trigger = getTrialProviderIconTrigger(container)
    await user.hover(trigger as HTMLElement)

    expect(await screen.findByText(/common\.modelProvider\.card\.modelAPI/)).toHaveTextContent('OpenAI')
  })

  it('should show modelSupported tooltip for installed provider without custom config', async () => {
    const user = userEvent.setup()
    const systemProviders = [
      {
        provider: 'langgenius/openai/openai',
        preferred_provider_type: 'system',
        custom_configuration: { available_credentials: [] },
      },
    ] as unknown as ModelProvider[]

    const { container } = render(<QuotaPanel providers={systemProviders} />)

    const trigger = getTrialProviderIconTrigger(container)
    await user.hover(trigger as HTMLElement)

    expect(await screen.findByText(/common\.modelProvider\.card\.modelSupported/)).toHaveTextContent('OpenAI')
  })
})
