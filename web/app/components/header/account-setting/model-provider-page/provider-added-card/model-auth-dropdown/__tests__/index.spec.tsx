import type { ModelProviderSummaryResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { CredentialPanelState } from '../../use-credential-panel-state'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { modelProviderDetailsQueryOptions } from '@/app/components/header/account-setting/model-provider-page/utils'
import {
  createProviderResponseFixture,
  createProviderSummaryFixture,
} from '@/test/console/model-provider'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
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

      expect(screen.getByRole('button', { name: /addApiKey/i })).toHaveAttribute(
        'aria-disabled',
        'true',
      )
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
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

    it('shares the provider detail response across cards without opening a loading popup', async () => {
      const user = userEvent.setup()
      const request = createDeferred<Response>()
      const fetchMock = vi.mocked(globalThis.fetch).mockReturnValueOnce(request.promise)
      render(
        <>
          {['openai', 'tongyi'].map((provider) => (
            <ModelAuthDropdown
              key={provider}
              provider={createProviderSummaryFixture({ provider })}
              state={createState()}
              isChangingPriority={false}
              onChangePriority={onChangePriority}
            />
          ))}
        </>,
      )
      const triggers = screen.getAllByRole('button', { name: /addApiKey/i })
      await user.click(triggers[0]!)
      expect(triggers[0]).toHaveFocus()
      expect(triggers[0]).toHaveAttribute('aria-disabled', 'true')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
      await act(async () =>
        request.resolve(
          Response.json({
            data: ['openai', 'tongyi'].map((provider) =>
              createProviderResponseFixture({ provider }),
            ),
          }),
        ),
      )
      expect(await screen.findByRole('dialog')).toBeInTheDocument()
      await user.keyboard('{Escape}')
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(triggers[0]).toHaveFocus()
      await user.click(triggers[1]!)
      expect(await screen.findByRole('dialog')).toBeInTheDocument()
      expect(fetchMock).toHaveBeenCalledOnce()
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
