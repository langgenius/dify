import type { ModelProviderSummaryResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createProviderResponseFixture } from '@/test/console/model-provider'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import LazyCustomModelActions from '../lazy-custom-model-actions'

const { loadDetails, mockOpenModelModal } = vi.hoisted(() => ({
  loadDetails: vi.fn(),
  mockOpenModelModal: vi.fn(),
}))
vi.mock('../../hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks')>()),
  useModelModalHandler: () => mockOpenModelModal,
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.modelProviders.get': loadDetails,
    }),
  }
})

// Credential editing owns the modal internals; this test owns lazy loading and which surface opens.
vi.mock('@/app/components/header/account-setting/model-provider-page/model-auth', () => ({
  AddCustomModel: ({ open }: { open?: boolean }) => (
    <div data-open={open} data-testid="add-custom-model" />
  ),
  ManageCustomModelCredentials: ({ isOpen }: { isOpen?: boolean }) => (
    <div data-open={isOpen} data-testid="manage-custom-model" />
  ),
}))

const createProvider = (hasCustomModels: boolean): ModelProviderSummaryResponse => ({
  provider: 'langgenius/openai/openai',
  plugin_id: 'langgenius/openai',
  label: { en_US: 'OpenAI' },
  supported_model_types: ['llm'],
  configurate_methods: ['customizable-model'],
  preferred_provider_type: 'custom',
  is_configured: true,
  custom_configuration: {
    status: 'active',
    has_custom_models: hasCustomModels,
    available_credentials: [],
    current_credential_usable: false,
  },
  system_configuration: { enabled: false },
})

describe('LazyCustomModelActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadDetails.mockResolvedValue({
      data: [
        createProviderResponseFixture({
          provider: 'langgenius/openai/openai',
          custom_configuration: {
            can_added_models: [{ model: 'custom-gpt-2', model_type: 'llm' }],
          },
        }),
      ],
    })
  })

  it('loads provider detail and opens credential management on demand', async () => {
    const user = userEvent.setup()
    render(<LazyCustomModelActions provider={createProvider(true)} />)

    expect(loadDetails).not.toHaveBeenCalled()

    await user.click(
      screen.getByRole('button', { name: 'modelProvider.modelProvider.auth.manageCredentials' }),
    )

    expect(await screen.findByTestId('manage-custom-model')).toHaveAttribute('data-open', 'true')
    expect(loadDetails).toHaveBeenCalledTimes(1)
  })

  it('does not render credential management without custom models', () => {
    render(<LazyCustomModelActions provider={createProvider(false)} />)

    expect(
      screen.queryByRole('button', { name: 'modelProvider.modelProvider.auth.manageCredentials' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'modelProvider.modelProvider.addModel' }),
    ).toBeInTheDocument()
  })
})
