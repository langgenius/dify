import type { ModelProviderSummaryResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ModelProvider } from '../../../declarations'
import type { CredentialPanelState } from '../../use-credential-panel-state'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { commonQueryKeys } from '@/service/use-common'
import { renderWithConsoleQuery } from '@/test/console/query-data'
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

vi.mock('../use-activate-credential', () => ({
  useActivateCredential: () => ({
    selectedCredentialId: undefined,
    isActivating: false,
    activate: vi.fn(),
  }),
}))

vi.mock('../../use-trial-credits', () => ({
  useTrialCredits: () => ({
    credits: 0,
    totalCredits: 10_000,
    isExhausted: true,
    isLoading: false,
  }),
}))

const createProvider = (overrides: Partial<ModelProvider> = {}): ModelProvider =>
  ({
    provider: 'test',
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
  })

  describe('Button text', () => {
    it('should show "Add API Key" when no credentials for credits-active', () => {
      render(
        <ModelAuthDropdown
          provider={createProvider()}
          state={createState({ hasCredentials: false, variant: 'credits-active' })}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
        />,
      )
      expect(screen.getByRole('button', { name: /addApiKey/ })).toBeInTheDocument()
    })

    it('should show "Configure" when has credentials for api-active', () => {
      render(
        <ModelAuthDropdown
          provider={createProvider()}
          state={createState({ hasCredentials: true, variant: 'api-active' })}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
        />,
      )
      expect(screen.getByRole('button', { name: /config/i })).toBeInTheDocument()
    })

    it('should show "Add API Key" for api-required-add variant', () => {
      render(
        <ModelAuthDropdown
          provider={createProvider()}
          state={createState({ variant: 'api-required-add', hasCredentials: false })}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
        />,
      )
      expect(screen.getByRole('button', { name: /addApiKey/ })).toBeInTheDocument()
    })

    it('should show "Configure" for api-required-configure variant', () => {
      render(
        <ModelAuthDropdown
          provider={createProvider()}
          state={createState({ variant: 'api-required-configure', hasCredentials: true })}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
        />,
      )
      expect(screen.getByRole('button', { name: /config/i })).toBeInTheDocument()
    })

    it('should show "Configure" for credits-active when has credentials', () => {
      render(
        <ModelAuthDropdown
          provider={createProvider()}
          state={createState({ hasCredentials: true, variant: 'credits-active' })}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
        />,
      )
      expect(screen.getByRole('button', { name: /config/i })).toBeInTheDocument()
    })

    it('should show "Add API Key" for credits-exhausted (no credentials)', () => {
      render(
        <ModelAuthDropdown
          provider={createProvider()}
          state={createState({ variant: 'credits-exhausted', hasCredentials: false })}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
        />,
      )
      expect(screen.getByRole('button', { name: /addApiKey/ })).toBeInTheDocument()
    })

    it('should show "Configure" for api-unavailable (has credentials)', () => {
      render(
        <ModelAuthDropdown
          provider={createProvider()}
          state={createState({ variant: 'api-unavailable', hasCredentials: true })}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
        />,
      )
      expect(screen.getByRole('button', { name: /config/i })).toBeInTheDocument()
    })

    it('should show "Configure" for api-fallback (has credentials)', () => {
      render(
        <ModelAuthDropdown
          provider={createProvider()}
          state={createState({ variant: 'api-fallback', hasCredentials: true })}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
        />,
      )
      expect(screen.getByRole('button', { name: /config/i })).toBeInTheDocument()
    })
  })

  describe('Button variant styling', () => {
    it('should use primary for api-required-add', () => {
      const { container } = render(
        <ModelAuthDropdown
          provider={createProvider()}
          state={createState({ variant: 'api-required-add', hasCredentials: false })}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
        />,
      )
      const button = container.querySelector('button')
      expect(button?.getAttribute('data-variant') ?? button?.className).toMatch(/primary/)
    })

    it('should use primary for api-required-configure', () => {
      const { container } = render(
        <ModelAuthDropdown
          provider={createProvider()}
          state={createState({ variant: 'api-required-configure', hasCredentials: true })}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
        />,
      )
      const button = container.querySelector('button')
      expect(button?.getAttribute('data-variant') ?? button?.className).toMatch(/primary/)
    })
  })

  describe('Popover behavior', () => {
    it('should keep the popover open and allow retrying when loading a summary detail fails', async () => {
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
      const fullProvider = createProvider()
      render(
        <ModelAuthDropdown
          provider={providerSummary}
          state={createState()}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
        />,
      )
      let resolveFirstRequest: ((response: Response) => void) | undefined
      const fetchMock = vi.mocked(globalThis.fetch)
      fetchMock.mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveFirstRequest = resolve
          }),
      )

      fireEvent.click(screen.getByRole('button', { name: /addApiKey/i }))

      expect(await screen.findByRole('status')).toBeInTheDocument()
      await act(async () => {
        resolveFirstRequest?.(new Response(null, { status: 500 }))
      })
      expect(await screen.findByRole('alert')).toHaveTextContent('common.api.actionFailed')

      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [fullProvider] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.retry' }))

      await waitFor(() => {
        expect(screen.getByText('common.modelProvider.card.noApiKeysTitle')).toBeInTheDocument()
      })
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('should open popover on button click and show dropdown content', async () => {
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

      fireEvent.click(screen.getByRole('button', { name: /config/i }))

      await waitFor(() => {
        expect(screen.getByText('Key 1')).toBeInTheDocument()
      })
    })

    it('should load provider detail on first click and reuse it on reopen', async () => {
      const fullProvider = createProvider({
        custom_configuration: {
          status: CustomConfigurationStatusEnum.active,
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
      const rendered = render(
        <ModelAuthDropdown
          provider={providerSummary}
          state={createState({ hasCredentials: true, variant: 'api-active' })}
          isChangingPriority={false}
          onChangePriority={onChangePriority}
        />,
      )
      const fetchQuery = vi
        .spyOn(rendered.queryClient, 'fetchQuery')
        .mockImplementation(async () => {
          const response = { data: [fullProvider] }
          rendered.queryClient.setQueryData(commonQueryKeys.modelProviderDetails, response)
          return response
        })
      const trigger = screen.getByRole('button', { name: /config/i })

      fireEvent.click(trigger)

      await waitFor(() => {
        expect(screen.getByText('Key 1')).toBeInTheDocument()
      })
      expect(fetchQuery).toHaveBeenCalledTimes(1)

      fireEvent.click(trigger)
      await waitFor(() => {
        expect(screen.queryByText('Key 1')).not.toBeInTheDocument()
      })
      fireEvent.click(trigger)

      await waitFor(() => {
        expect(screen.getByText('Key 1')).toBeInTheDocument()
      })
      expect(fetchQuery).toHaveBeenCalledTimes(1)
    })

    it('should render updated provider detail from the query cache', async () => {
      const providerSummary = {
        provider: 'test',
        is_configured: true,
        custom_configuration: {
          available_credentials: [],
          current_credential_usable: true,
        },
      } as unknown as ModelProviderSummaryResponse
      const firstProvider = createProvider({
        custom_configuration: {
          status: CustomConfigurationStatusEnum.active,
          available_credentials: [{ credential_id: 'c1', credential_name: 'Key 1' }],
          current_credential_id: 'c1',
          current_credential_name: 'Key 1',
        },
      })
      const nextProvider = createProvider({
        custom_configuration: {
          status: CustomConfigurationStatusEnum.active,
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
      vi.spyOn(rendered.queryClient, 'fetchQuery').mockImplementation(async () => {
        const response = { data: [firstProvider] }
        rendered.queryClient.setQueryData(commonQueryKeys.modelProviderDetails, response)
        return response
      })

      fireEvent.click(screen.getByRole('button', { name: /config/i }))
      await waitFor(() => expect(screen.getByText('Key 1')).toBeInTheDocument())

      rendered.queryClient.setQueryData(commonQueryKeys.modelProviderDetails, {
        data: [nextProvider],
      })

      await waitFor(() => {
        expect(screen.getByText('Key 2')).toBeInTheDocument()
      })
      expect(screen.queryByText('Key 1')).not.toBeInTheDocument()
    })
  })
})
