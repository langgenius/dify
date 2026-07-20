import type { ReactElement } from 'react'
import type { ModelProvider } from '../../declarations'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithSystemFeatures } from '@/__tests__/utils/mock-system-features'
import QuotaPanel from '../quota-panel'

let mockWorkspaceData:
  | {
      trial_credits: number
      trial_credits_used: number
      trial_credits_exhausted_at?: number
      next_credit_reset_date: number
    }
  | undefined = {
  trial_credits: 100,
  trial_credits_used: 30,
  next_credit_reset_date: 1735603200,
}
let mockWorkspaceIsPending = false
let mockTrialModels: string[] | undefined = ['langgenius/openai/openai']
let mockPlugins = [
  {
    plugin_id: 'langgenius/openai',
    latest_package_identifier: 'openai@1.0.0',
  },
]

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

vi.mock('../use-trial-credits', () => ({
  useTrialCredits: () => {
    const totalCredits = Math.max(mockWorkspaceData?.trial_credits ?? 0, 0)
    const rawUsedCredits = mockWorkspaceData?.trial_credits_used ?? 0
    const normalizedUsedCredits = Math.max(rawUsedCredits, 0)
    const usedCredits = Math.min(normalizedUsedCredits, totalCredits)
    const credits = Math.max(totalCredits - usedCredits, 0)
    return {
      credits,
      usedCredits,
      totalCredits,
      isExhausted: credits <= 0,
      isLoading: mockWorkspaceIsPending && !mockWorkspaceData,
      exhaustedAt: mockWorkspaceData?.trial_credits_exhausted_at,
      nextCreditResetDate: mockWorkspaceData?.next_credit_reset_date,
    }
  },
}))

const renderQuotaPanel = (ui: ReactElement) =>
  renderWithSystemFeatures(ui, {
    trialModels: mockTrialModels ?? [],
  })

vi.mock('../../hooks', () => ({
  useMarketplaceAllPlugins: () => ({
    plugins: mockPlugins,
  }),
}))

vi.mock(
  '@/app/components/plugins/install-plugin/hooks/use-workspace-plugin-install-permission',
  () => ({
    default: () => ({
      canInstallPlugin: true,
      canUpdatePlugin: true,
      currentDifyVersion: '1.0.0',
    }),
  }),
)

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatTime: () => 'Dec 31',
    formatMonthDay: () => 'Dec 31',
  }),
}))

vi.mock('@/app/components/plugins/install-plugin/install-from-marketplace', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div>
      <span>install modal</span>
      <button type="button" onClick={onClose}>
        close install
      </button>
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
      next_credit_reset_date: 1735603200,
    }
    mockWorkspaceIsPending = false
    mockTrialModels = ['langgenius/openai/openai']
    mockPlugins = [{ plugin_id: 'langgenius/openai', latest_package_identifier: 'openai@1.0.0' }]
  })

  it('should render loading state', () => {
    mockWorkspaceData = undefined
    mockWorkspaceIsPending = true

    renderQuotaPanel(<QuotaPanel providers={mockProviders} />)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('should show used credits, total credits, and reset date', () => {
    renderQuotaPanel(<QuotaPanel providers={mockProviders} />)

    expect(screen.getByText(/modelProvider\.quota/)).toBeInTheDocument()
    expect(screen.getByText('30')).toBeInTheDocument()
    expect(screen.getByText('/')).toHaveClass('font-normal', 'text-text-tertiary')
    expect(screen.getByText('/')).not.toHaveClass('system-xl-semibold')
    expect(screen.getByText('100')).toBeInTheDocument()
    expect(screen.getByText(/modelProvider\.used/)).toBeInTheDocument()
    expect(screen.queryByText(/modelProvider\.ranOutDate/)).not.toBeInTheDocument()
    expect(screen.getByText(/modelProvider\.resetDate/)).toBeInTheDocument()
  })

  it('should keep quota content during background refetch when cached workspace exists', () => {
    mockWorkspaceIsPending = true

    renderQuotaPanel(<QuotaPanel providers={mockProviders} />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByText('30')).toBeInTheDocument()
  })

  it('should keep usage display within quota when usage is higher than quota', () => {
    mockWorkspaceData = {
      trial_credits: 10,
      trial_credits_used: 999,
      trial_credits_exhausted_at: 1733011200,
      next_credit_reset_date: 0,
    }

    renderQuotaPanel(<QuotaPanel providers={mockProviders} />)

    const usageNumbers = screen.getAllByText('10')
    expect(usageNumbers).toHaveLength(2)
    usageNumbers.forEach((number) => expect(number).toHaveClass('text-text-destructive'))
    expect(screen.getByText(/modelProvider\.used/)).toHaveClass('text-text-destructive')
    expect(screen.getByText(/modelProvider\.ranOutDate/)).toBeInTheDocument()
    expect(screen.getByText('/')).toHaveClass('font-normal', 'text-text-tertiary')
    expect(screen.getByText('/')).not.toHaveClass('system-xl-semibold', 'text-text-destructive')
    expect(screen.queryByText(/modelProvider\.resetDate/)).not.toBeInTheDocument()
  })

  it('should open install modal when clicking an unsupported trial provider', () => {
    renderQuotaPanel(<QuotaPanel providers={[]} />)

    fireEvent.click(screen.getByText('openai'))

    expect(screen.getByText('install modal')).toBeInTheDocument()
  })

  it('should close install modal when provider becomes installed', async () => {
    const { rerender } = renderQuotaPanel(<QuotaPanel providers={[]} />)

    fireEvent.click(screen.getByText('openai'))
    expect(screen.getByText('install modal')).toBeInTheDocument()

    rerender(<QuotaPanel providers={mockProviders} />)

    await waitFor(() => {
      expect(screen.queryByText('install modal')).not.toBeInTheDocument()
    })
  })

  it('should tolerate missing trial model configuration', () => {
    mockTrialModels = undefined

    renderQuotaPanel(<QuotaPanel providers={mockProviders} />)

    expect(screen.queryByText('openai')).not.toBeInTheDocument()
  })

  it('should render installed custom providers without opening the install modal', () => {
    renderQuotaPanel(<QuotaPanel providers={mockProviders} />)

    expect(screen.getByLabelText(/modelAPI/)).toBeInTheDocument()

    fireEvent.click(screen.getByText('openai'))

    expect(screen.queryByText('install modal')).not.toBeInTheDocument()
  })

  it('should show the supported-model tooltip for installed non-custom providers', () => {
    renderQuotaPanel(
      <QuotaPanel
        providers={
          [
            {
              provider: 'langgenius/openai/openai',
              preferred_provider_type: 'system',
              custom_configuration: { available_credentials: [] },
            },
          ] as unknown as ModelProvider[]
        }
      />,
    )

    expect(screen.getByLabelText(/modelSupported/)).toBeInTheDocument()
  })
})
