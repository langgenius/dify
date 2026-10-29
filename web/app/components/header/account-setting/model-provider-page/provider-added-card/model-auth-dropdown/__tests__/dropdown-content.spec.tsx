import type { ModelProvider } from '../../../declarations'
import type { CredentialPanelState } from '../../use-credential-panel-state'
import { zProviderResponse } from '@dify/contracts/api/console/workspaces/zod.gen'
import { useQuery } from '@tanstack/react-query'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import {
  createCredentialProvider,
  credential,
  renderCredentialComponent,
} from '../../../__tests__/credential-test-env'
import { modelProviderDetailsQueryOptions } from '../../../utils'
import DropdownContent from '../dropdown-content'

const requests = vi.hoisted(() => ({ activate: vi.fn(), remove: vi.fn(), providers: vi.fn() }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.modelProviders.byProvider.credentials.switch.post': requests.activate,
      'workspaces.current.modelProviders.get': requests.providers,
      'workspaces.current.modelProviders.byProvider.credentials.get': () => ({
        credentials: { api_key: 'saved-secret' },
      }),
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.modelProviders.byProvider.credentials.delete': requests.remove,
    }),
  }
})
const other = { credential_id: 'cred-2', credential_name: 'Other Key' }
const provider = () =>
  createCredentialProvider({
    custom_configuration: {
      status: 'active',
      current_credential_id: credential.credential_id,
      current_credential_name: credential.credential_name,
      available_credentials: [credential, other],
    },
  })
const createState = (overrides: Partial<CredentialPanelState> = {}): CredentialPanelState => ({
  variant: 'api-active',
  priority: 'apiKey',
  supportsCredits: true,
  showPrioritySwitcher: true,
  hasCredentials: true,
  isCreditsExhausted: false,
  credentialName: 'My Key',
  credits: 100,
  ...overrides,
})

beforeEach(() => {
  requests.activate.mockResolvedValue({ result: 'success' })
  requests.remove.mockResolvedValue({ result: 'success' })
  requests.providers.mockResolvedValue({ data: [provider()] })
})
function renderContent({
  initialProvider = provider(),
  state = createState(),
  permissions = ['credential.use', 'credential.create', 'credential.manage'],
}: { initialProvider?: ModelProvider; state?: CredentialPanelState; permissions?: string[] } = {}) {
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(modelProviderDetailsQueryOptions().queryKey, {
    data: [zProviderResponse.parse({ ...initialProvider, tenant_id: 'workspace-1' })],
  })
  function Caller() {
    const [open, setOpen] = useState(true)
    const { data } = useQuery(
      consoleQuery.workspaces.current.modelProviders.get.queryOptions({ input: {} }),
    )
    return open ? (
      <section aria-label="Credential menu">
        <DropdownContent
          provider={data!.data[0] as ModelProvider}
          state={state}
          isChangingPriority={false}
          onChangePriority={() => {}}
          onClose={() => setOpen(false)}
        />
      </section>
    ) : null
  }
  return renderCredentialComponent(<Caller />, {
    queryClient,
    workspacePermissionKeys: permissions,
  })
}
it.each([true, false])(
  'shows the priority switcher only when requested: %s',
  (showPrioritySwitcher) => {
    renderContent({ state: createState({ showPrioritySwitcher }) })
    expect(!!screen.queryByText(/usagePriority/)).toBe(showPrioritySwitcher)
  },
)
it.each([
  {
    variant: 'api-fallback',
    priority: 'credits',
    exhausted: true,
    supported: true,
    expected: /creditsExhaustedFallback/,
  },
  {
    variant: 'credits-exhausted',
    priority: 'credits',
    exhausted: true,
    supported: true,
    expected: /creditsExhaustedMessage/,
  },
  { variant: 'api-active', priority: 'apiKey', exhausted: false, supported: true, expected: null },
  {
    variant: 'credits-exhausted',
    priority: 'credits',
    exhausted: true,
    supported: false,
    expected: null,
  },
] as const)(
  'shows the appropriate exhausted-credit message: $variant/$supported',
  ({ variant, priority, exhausted, supported, expected }) => {
    renderContent({
      state: createState({
        variant,
        priority,
        isCreditsExhausted: exhausted,
        supportsCredits: supported,
      }),
    })
    if (expected) expect(screen.getAllByText(expected).length).toBeGreaterThan(0)
    else expect(screen.queryByText(/creditsExhausted/)).not.toBeInTheDocument()
  },
)
it.each([
  { variant: 'credits-active', priority: 'apiKey', visible: true },
  { variant: 'api-active', priority: 'apiKey', visible: false },
  { variant: 'credits-active', priority: 'credits', visible: false },
] as const)(
  'shows the API-key fallback only for $variant/$priority',
  ({ variant, priority, visible }) => {
    renderContent({ state: createState({ variant, priority, hasCredentials: false }) })
    expect(!!screen.queryByText(/noApiKeysFallback/)).toBe(visible)
  },
)
it('activates a credential, guards concurrent clicks and refreshes the live provider', async () => {
  const user = userEvent.setup()
  const pending = createDeferred<{ result: string }>()
  requests.activate.mockReturnValueOnce(pending.promise)
  requests.providers.mockResolvedValue({
    data: [
      createCredentialProvider({
        custom_configuration: {
          status: 'active',
          current_credential_id: other.credential_id,
          available_credentials: [{ ...other, credential_name: 'Refreshed key' }],
        },
      }),
    ],
  })
  renderContent()
  await user.click(screen.getByRole('button', { name: 'Other Key' }))
  expect(screen.getByRole('button', { name: 'Other Key' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: 'Key 1' })).toBeDisabled()
  expect(requests.activate).toHaveBeenCalledExactlyOnceWith({
    params: { provider: 'openai' },
    body: { credential_id: 'cred-2' },
  })
  await act(async () => pending.resolve({ result: 'success' }))
  expect(await screen.findByRole('button', { name: 'Refreshed key' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect(screen.queryByRole('button', { name: 'Other Key' })).not.toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Credential menu' })).toBeInTheDocument()
})
it('opens the selected credential for editing and closes the menu', async () => {
  const user = userEvent.setup()
  const onlyOther = provider()
  onlyOther.custom_configuration.available_credentials = [other]
  renderContent({ initialProvider: onlyOther, permissions: ['credential.manage'] })
  expect(screen.queryByRole('button', { name: 'Other Key' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /addApiKey/ })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
  expect(await screen.findByRole('textbox', { name: /authorizationName/ })).toHaveValue('Other Key')
  expect(await screen.findByLabelText(/API key/)).toHaveValue('saved-secret')
  expect(screen.queryByLabelText('Credential menu')).not.toBeInTheDocument()
})
it('cancels removal without deleting, then confirms and refreshes the remaining keys', async () => {
  const user = userEvent.setup()
  const onlyOther = provider()
  onlyOther.custom_configuration.available_credentials = [other]
  requests.providers.mockResolvedValue({
    data: [
      createCredentialProvider({
        custom_configuration: { status: 'active', available_credentials: [] },
      }),
    ],
  })
  renderContent({ initialProvider: onlyOther, permissions: ['credential.manage'] })
  await user.click(screen.getByRole('button', { name: 'common.operation.delete' }))
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'common.operation.cancel',
    }),
  )
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  expect(requests.remove).not.toHaveBeenCalled()
  expect(screen.getByText('Other Key')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'common.operation.delete' }))
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'common.operation.delete',
    }),
  )
  await waitFor(() =>
    expect(requests.remove).toHaveBeenCalledExactlyOnceWith({
      params: { provider: 'openai' },
      body: { credential_id: 'cred-2' },
    }),
  )
  await waitFor(() => expect(screen.queryByText('Other Key')).not.toBeInTheDocument())
  expect(screen.getByText(/noApiKeysTitle/)).toBeInTheDocument()
})
it('lets use-only users switch credentials without creation or management controls', async () => {
  const user = userEvent.setup()
  renderContent({ permissions: ['credential.use'] })
  expect(screen.queryByRole('button', { name: 'common.operation.edit' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'common.operation.delete' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /addApiKey/ })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Other Key' }))
  await waitFor(() =>
    expect(requests.activate).toHaveBeenCalledWith({
      params: { provider: 'openai' },
      body: { credential_id: 'cred-2' },
    }),
  )
})
it.each([true, false])(
  'opens a blank API-key form for create-only users (empty=%s)',
  async (empty) => {
    const user = userEvent.setup()
    const initialProvider = provider()
    if (empty) initialProvider.custom_configuration.available_credentials = []
    renderContent({ initialProvider, permissions: ['credential.create'] })
    if (empty) {
      expect(screen.getByText(/noApiKeysTitle/)).toBeInTheDocument()
      expect(screen.getByText(/noApiKeysDescription/)).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: 'Other Key' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.operation.edit' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'common.operation.delete' }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /addApiKey/ }))
    expect(await screen.findByLabelText(/API key/)).toHaveValue('')
    expect(screen.queryByLabelText('Credential menu')).not.toBeInTheDocument()
  },
)
