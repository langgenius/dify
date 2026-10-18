import type { ModelProviderCreditsResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ReactElement } from 'react'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createModelProviderFixture } from '@/test/fixtures/model-provider'
import QuotaPanel from '../quota-panel'

const createCredits = (
  overrides: Partial<ModelProviderCreditsResponse> = {},
): ModelProviderCreditsResponse => ({
  quota_limit: 100,
  quota_used: 30,
  remaining_credits: 70,
  is_unlimited: false,
  is_exhausted: false,
  exhausted_at: null,
  next_credit_reset_date: 1735603200,
  pool_type: 'trial',
  ...overrides,
})
let credits: ModelProviderCreditsResponse | undefined
const getCredits = vi.hoisted(() => vi.fn())
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.modelProviders.credits.get': getCredits,
    }),
  }
})
let mockTrialModels: string[] | undefined = ['langgenius/openai/openai']
const mockFetchManifestFromMarketPlace = vi.fn(async (_uniqueIdentifier: string) => ({
  data: {
    plugin: {
      name: 'registry-openai',
      org: 'marketplace-cache',
      icon: '',
      label: { en_US: 'OpenAI' },
      category: 'model' as const,
      version: '1.0.0',
      latest_version: '1.0.0',
      brief: {},
      introduction: '',
      verified: true,
      install_count: 0,
      badges: [],
      verification: { authorized_category: 'langgenius' as const },
      from: 'package' as const,
    },
  },
}))
const mockFetchPluginInfoFromMarketPlace = vi.fn(async (_params: Record<string, string>) => ({
  data: {
    plugin: {
      category: 'model' as const,
      latest_package_identifier: 'openai@1.0.0',
      latest_version: '1.0.0',
    },
  },
}))

vi.mock('@/service/plugins', () => ({
  fetchManifestFromMarketPlace: (uniqueIdentifier: string) =>
    mockFetchManifestFromMarketPlace(uniqueIdentifier),
  fetchPluginInfoFromMarketPlace: (params: Record<string, string>) =>
    mockFetchPluginInfoFromMarketPlace(params),
}))

const renderQuotaPanel = (ui: ReactElement) => {
  const queryClient = createConsoleQueryClient()
  if (credits)
    queryClient.setQueryData(
      consoleQuery.workspaces.current.modelProviders.credits.get.queryKey(),
      credits,
    )
  return renderWithConsoleQuery(ui, { queryClient, trialModels: mockTrialModels ?? [] })
}

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
  default: ({
    manifest,
    uniqueIdentifier,
    onClose,
  }: {
    manifest: { from: string; icon: string; name: string; org: string }
    uniqueIdentifier: string
    onClose: () => void
  }) => (
    <div
      data-icon={manifest.icon}
      data-from={manifest.from}
      data-name={manifest.name}
      data-org={manifest.org}
      data-unique-identifier={uniqueIdentifier}
      data-testid="install-modal"
    >
      <span>install modal</span>
      <button type="button" onClick={onClose}>
        close install
      </button>
    </div>
  ),
}))

describe('QuotaPanel', () => {
  const mockProviders = [
    createModelProviderFixture({
      custom_configuration: {
        status: 'active',
        available_credentials: [{ credential_id: '1' }],
      },
    }),
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    credits = createCredits()
    getCredits.mockReset().mockImplementation(() => new Promise(() => {}))
    mockTrialModels = ['langgenius/openai/openai']
    mockFetchManifestFromMarketPlace.mockClear()
    mockFetchPluginInfoFromMarketPlace.mockReset()
    mockFetchPluginInfoFromMarketPlace.mockResolvedValue({
      data: {
        plugin: {
          category: 'model',
          latest_package_identifier: 'openai@1.0.0',
          latest_version: '1.0.0',
        },
      },
    })
  })

  it('should render loading state', () => {
    credits = undefined

    renderQuotaPanel(<QuotaPanel providers={mockProviders} />)
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
  })

  it('should show used credits, total credits, and reset date', () => {
    renderQuotaPanel(<QuotaPanel providers={mockProviders} />)

    expect(screen.getByText(/modelProvider\.quota/)).toBeInTheDocument()
    expect(screen.getByText('30')).toBeInTheDocument()
    expect(screen.getByText('100')).toBeInTheDocument()
    expect(screen.getByText(/modelProvider\.used/)).toBeInTheDocument()
    expect(screen.queryByText(/modelProvider\.ranOutDate/)).not.toBeInTheDocument()
    expect(screen.getByText(/modelProvider\.resetDate/)).toBeInTheDocument()
  })

  it('keeps cached quota visible during refetch and displays the updated response', async () => {
    const request = createDeferred<ModelProviderCreditsResponse>()
    getCredits.mockReturnValue(request.promise)
    const { queryClient } = renderQuotaPanel(<QuotaPanel providers={mockProviders} />)
    act(() => {
      void queryClient.invalidateQueries({
        queryKey: consoleQuery.workspaces.current.modelProviders.credits.get.queryKey(),
      })
    })
    await waitFor(() => expect(getCredits).toHaveBeenCalledOnce())
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.getByText('30')).toBeInTheDocument()
    await act(async () => request.resolve(createCredits({ quota_used: 40, remaining_credits: 60 })))
    expect(await screen.findByText('40')).toBeInTheDocument()
    expect(screen.queryByText('30')).not.toBeInTheDocument()
  })

  it('shows exhausted quota and the exhaustion date from the server', () => {
    credits = createCredits({
      quota_limit: 10,
      quota_used: 10,
      remaining_credits: 0,
      is_exhausted: true,
      exhausted_at: 1733011200,
      next_credit_reset_date: null,
    })

    renderQuotaPanel(<QuotaPanel providers={mockProviders} />)

    const usageNumbers = screen.getAllByText('10')
    expect(usageNumbers).toHaveLength(2)
    expect(screen.getByText(/modelProvider\.ranOutDate/)).toBeInTheDocument()
    expect(screen.queryByText(/modelProvider\.resetDate/)).not.toBeInTheDocument()
  })

  it('should show unlimited credits instead of backend sentinel values', () => {
    credits = createCredits({
      quota_limit: -1,
      quota_used: 999,
      remaining_credits: -1,
      is_unlimited: true,
      next_credit_reset_date: null,
    })

    renderQuotaPanel(<QuotaPanel providers={mockProviders} />)

    expect(screen.getByText('common.license.unlimited')).toBeInTheDocument()
    expect(screen.queryByText('999')).not.toBeInTheDocument()
    expect(screen.queryByText('-1')).not.toBeInTheDocument()
    expect(screen.queryByText(/modelProvider\.used/)).not.toBeInTheDocument()
  })

  it('should open install modal when clicking an unsupported trial provider', async () => {
    const user = userEvent.setup()
    renderQuotaPanel(<QuotaPanel providers={[]} />)

    await user.click(screen.getByRole('button', { name: /modelNotSupported/ }))

    await waitFor(() => expect(screen.getByText('install modal')).toBeInTheDocument())
    expect(mockFetchManifestFromMarketPlace).toHaveBeenCalledWith('openai@1.0.0')
    expect(mockFetchPluginInfoFromMarketPlace).toHaveBeenCalledWith({
      org: 'langgenius',
      name: 'openai',
    })
    expect(screen.getByTestId('install-modal')).toHaveAttribute(
      'data-unique-identifier',
      'openai@1.0.0',
    )
    expect(screen.getByTestId('install-modal')).toHaveAttribute('data-icon', 'marketplace')
    expect(screen.getByTestId('install-modal')).toHaveAttribute('data-from', 'marketplace')
    expect(screen.getByTestId('install-modal')).toHaveAttribute('data-org', 'langgenius')
    expect(screen.getByTestId('install-modal')).toHaveAttribute('data-name', 'openai')
  })

  it('should prevent duplicate marketplace requests while a provider is loading', async () => {
    const user = userEvent.setup()
    mockFetchPluginInfoFromMarketPlace.mockImplementation(() => new Promise(() => {}))
    renderQuotaPanel(<QuotaPanel providers={[]} />)
    const providerButton = screen.getByLabelText(/modelNotSupported/)

    await user.click(providerButton)
    await user.click(providerButton)

    await waitFor(() => {
      expect(mockFetchPluginInfoFromMarketPlace).toHaveBeenCalledTimes(1)
    })
    expect(providerButton).toHaveAttribute('aria-busy', 'true')
    expect(providerButton).toHaveAttribute('aria-disabled', 'true')
  })

  it('should allow retrying marketplace installation after a request failure', async () => {
    const user = userEvent.setup()
    mockFetchPluginInfoFromMarketPlace.mockRejectedValueOnce(new Error('Marketplace unavailable'))
    renderQuotaPanel(<QuotaPanel providers={[]} />)
    const providerButton = screen.getByLabelText(/modelNotSupported/)

    await user.click(providerButton)

    await waitFor(() => expect(providerButton).toHaveAttribute('aria-busy', 'false'))
    expect(screen.queryByText('install modal')).not.toBeInTheDocument()

    await user.click(providerButton)

    await waitFor(() => expect(screen.getByText('install modal')).toBeInTheDocument())
    expect(mockFetchPluginInfoFromMarketPlace).toHaveBeenCalledTimes(2)
  })

  it('should close install modal when provider becomes installed', async () => {
    const user = userEvent.setup()
    const { rerender } = renderQuotaPanel(<QuotaPanel providers={[]} />)

    await user.click(screen.getByRole('button', { name: /modelNotSupported/ }))
    await waitFor(() => expect(screen.getByText('install modal')).toBeInTheDocument())

    rerender(<QuotaPanel providers={mockProviders} />)

    await waitFor(() => {
      expect(screen.queryByText('install modal')).not.toBeInTheDocument()
    })
  })

  it('should tolerate missing trial model configuration', () => {
    mockTrialModels = undefined

    renderQuotaPanel(<QuotaPanel providers={mockProviders} />)

    expect(
      screen.queryByRole('button', { name: /model(?:NotSupported|Supported|API)/ }),
    ).not.toBeInTheDocument()
  })

  it('should render installed custom providers without opening the install modal', async () => {
    const user = userEvent.setup()
    renderQuotaPanel(<QuotaPanel providers={mockProviders} />)

    expect(screen.getByLabelText(/modelAPI/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /modelAPI/ }))

    expect(screen.queryByText('install modal')).not.toBeInTheDocument()
  })

  it('should show the supported-model tooltip for installed non-custom providers', () => {
    renderQuotaPanel(
      <QuotaPanel
        providers={[createModelProviderFixture({ preferred_provider_type: 'system' })]}
      />,
    )

    expect(screen.getByLabelText(/modelSupported/)).toBeInTheDocument()
  })
})
