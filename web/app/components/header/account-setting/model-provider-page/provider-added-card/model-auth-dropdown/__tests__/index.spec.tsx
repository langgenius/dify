import type { ModelProviderSummaryResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ModelProvider } from '../../../declarations'
import type { CredentialPanelState } from '../../use-credential-panel-state'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { modelProviderDetailsQueryOptions } from '@/app/components/header/account-setting/model-provider-page/utils'
import { createProviderResponseFixture } from '@/test/console/model-provider'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { CustomConfigurationStatusEnum, PreferredProviderTypeEnum } from '../../../declarations'
import ModelAuthDropdown from '../index'

const render = (ui: React.ReactElement) => renderWithConsoleQuery(ui)

vi.mock('../../../model-auth/hooks', () => ({
  useAuth: () => ({
    openConfirmDelete: vi.fn(),
    closeConfirmDelete: vi.fn(),
    doingAction: false,
    handleConfirmDelete: vi.fn(),
    deleteCredentialId: null,
    handleOpenModal: vi.fn(),
  }),
}))

const createProvider = (overrides: Partial<ModelProvider> = {}): ModelProvider =>
  ({
    ...createProviderResponseFixture({ provider: 'test' }),
    custom_configuration: {
      status: CustomConfigurationStatusEnum.active,
      available_credentials: [],
    },
    system_configuration: { enabled: true, current_quota_type: 'trial', quota_configurations: [] },
    preferred_provider_type: PreferredProviderTypeEnum.system,
    ...overrides,
  }) as unknown as ModelProvider

const createState = (overrides: Partial<CredentialPanelState> = {}): CredentialPanelState => ({
  variant: 'credits-active',
  priority: 'credits',
  supportsCredits: true,
  showPrioritySwitcher: false,
  hasCredentials: false,
  isCreditsExhausted: false,
  credentialName: undefined,
  credits: 100,
  ...overrides,
})

describe('ModelAuthDropdown', () => {
  const onChangePriority = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(globalThis.fetch).mockReset()
  })

  describe('Popover behavior', () => {
    it('should keep the popover open and allow retrying when loading a summary detail fails', async () => {
      const user = userEvent.setup()
      const providerSummary = {
        provider: 'test',
        plugin_id: 'test-plugin',
        label: { en_US: 'Test', zh_Hans: 'Test' },
        supported_model_types: ['llm'],
        configurate_methods: [],
        preferred_provider_type: 'system',
        is_configured: true,
        custom_configuration: {
          status: 'active',
          has_custom_models: false,
          available_credentials: [],
          current_credential_usable: false,
        },
        system_configuration: { enabled: true },
      } satisfies ModelProviderSummaryResponse
      const fullProvider = createProviderResponseFixture({ provider: 'test' })
      render(
        <ModelAuthDropdown
          provider={providerSummary}
          state={createState()}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
        />,
      )
      const firstRequest = createDeferred<Response>()
      const fetchMock = vi.mocked(globalThis.fetch)
      fetchMock.mockReturnValueOnce(firstRequest.promise)

      await user.click(screen.getByRole('button', { name: /addApiKey/i }))

      expect(await screen.findByRole('status')).toBeInTheDocument()
      // The console client loads its contract segment before the first request starts.
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
      await act(async () => {
        firstRequest.resolve(new Response(null, { status: 500 }))
      })
      expect(await screen.findByRole('alert')).toHaveTextContent('common.api.actionFailed')

      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [fullProvider] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))

      await waitFor(() => {
        expect(
          screen.getByText('modelProvider.modelProvider.card.noApiKeysTitle'),
        ).toBeInTheDocument()
      })
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('should open popover on button click and show dropdown content', async () => {
      const user = userEvent.setup()
      render(
        <ModelAuthDropdown
          provider={createProvider({
            custom_configuration: {
              status: CustomConfigurationStatusEnum.active,
              available_credentials: [{ credential_id: 'c1', credential_name: 'Key 1' }],
              current_credential_id: 'c1',
              current_credential_name: 'Key 1',
            },
          })}
          state={createState({ hasCredentials: true, variant: 'api-active' })}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
        />,
      )

      await user.click(screen.getByRole('button', { name: /config/i }))

      await waitFor(() => {
        expect(screen.getByText('Key 1')).toBeInTheDocument()
      })
      expect(screen.getByRole('dialog', { name: /config/i })).toBeInTheDocument()
    })

    it('should load provider detail on first click and reuse it on reopen', async () => {
      const user = userEvent.setup()
      const fullProvider = createProviderResponseFixture({
        provider: 'test',
        custom_configuration: {
          available_credentials: [{ credential_id: 'c1', credential_name: 'Key 1' }],
          current_credential_id: 'c1',
          current_credential_name: 'Key 1',
        },
      })
      const providerSummary = {
        provider: 'test',
        is_configured: true,
        custom_configuration: {
          available_credentials: [{ credential_id: 'c1', credential_name: 'Key 1' }],
          current_credential_id: 'c1',
          current_credential_name: 'Key 1',
          current_credential_usable: true,
        },
      } as unknown as ModelProviderSummaryResponse
      render(
        <ModelAuthDropdown
          provider={providerSummary}
          state={createState({ hasCredentials: true, variant: 'api-active' })}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
        />,
      )
      const fetchMock = vi.mocked(globalThis.fetch)
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [fullProvider] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      const trigger = screen.getByRole('button', { name: /config/i })

      await user.click(trigger)

      await waitFor(() => {
        expect(screen.getByText('Key 1')).toBeInTheDocument()
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)

      await user.click(trigger)
      await waitFor(() => {
        expect(screen.queryByText('Key 1')).not.toBeInTheDocument()
      })
      await user.click(trigger)

      await waitFor(() => {
        expect(screen.getByText('Key 1')).toBeInTheDocument()
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('should render updated provider detail from the query cache', async () => {
      const user = userEvent.setup()
      const providerSummary = {
        provider: 'test',
        is_configured: true,
        custom_configuration: {
          available_credentials: [],
          current_credential_usable: true,
        },
      } as unknown as ModelProviderSummaryResponse
      const firstProvider = createProviderResponseFixture({
        provider: 'test',
        custom_configuration: {
          available_credentials: [{ credential_id: 'c1', credential_name: 'Key 1' }],
          current_credential_id: 'c1',
          current_credential_name: 'Key 1',
        },
      })
      const nextProvider = createProviderResponseFixture({
        provider: 'test',
        custom_configuration: {
          available_credentials: [{ credential_id: 'c2', credential_name: 'Key 2' }],
          current_credential_id: 'c2',
          current_credential_name: 'Key 2',
        },
      })
      const rendered = render(
        <ModelAuthDropdown
          provider={providerSummary}
          state={createState({ hasCredentials: true, variant: 'api-active' })}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
        />,
      )
      const fetchMock = vi.mocked(globalThis.fetch)
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [firstProvider] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      await user.click(screen.getByRole('button', { name: /config/i }))
      await waitFor(() => expect(screen.getByText('Key 1')).toBeInTheDocument())

      act(() => {
        rendered.queryClient.setQueryData(modelProviderDetailsQueryOptions().queryKey, {
          data: [nextProvider],
        })
      })

      await waitFor(() => {
        expect(screen.getByText('Key 2')).toBeInTheDocument()
      })
      expect(screen.queryByText('Key 1')).not.toBeInTheDocument()
    })
  })
})
