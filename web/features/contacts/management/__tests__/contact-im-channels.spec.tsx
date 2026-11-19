import type {
  ChannelSummary,
  ContactImBindingDetail,
  ImIdentity,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { ContactsFeatureContextValue, ContactView } from '../types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ContactsManagementProvider } from '../composition'
import { ContactDetailsPanel } from '../contact-details-panel'
import { alice, managerContext } from './fixtures/data'

const api = vi.hoisted(() => ({
  channels: vi.fn(),
  identities: vi.fn(),
  bind: vi.fn(),
  override: vi.fn(),
  unbind: vi.fn(),
  reset: vi.fn(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.humanInput.v2.channels.get': api.channels,
      'workspaces.current.humanInput.v2.imIdentities.get': api.identities,
      'workspaces.current.humanInput.v2.contacts.byContactId.imBindings.put': api.bind,
      'workspaces.current.humanInput.v2.contacts.byContactId.imOverride.put': api.override,
      'workspaces.current.humanInput.v2.contacts.byContactId.imBindings.delete': api.unbind,
      'workspaces.current.humanInput.v2.contacts.byContactId.imOverride.delete': api.reset,
    }),
  }
})
const identity: ImIdentity = {
  id: 'identity-1',
  display_name: 'Alice IM',
  provider: 'feishu',
  provider_user_id: 'ou_alice',
  email: 'alice.im@example.com',
  binding_status: 'unbound',
}
const detail: ContactImBindingDetail = {
  id: 'binding-1',
  provider: 'feishu',
  scope: 'organization',
  identity: {
    id: identity.id,
    display_name: identity.display_name ?? null,
    email: identity.email ?? null,
    provider_user_id: identity.provider_user_id,
  },
}
const channel: ChannelSummary = {
  id: 'channel-1',
  config_version: 'version-1',
  created_at: 1780000000,
  updated_at: 1780000000,
  display_identifier: 'Test Feishu',
  kind: 'im',
  provider: 'feishu',
  status: 'connected',
  status_description: '',
  webhook_url: null,
}
const workspaceContact: ContactView = {
  ...alice,
  type: 'workspace',
  im_bindings: [{ id: detail.id, provider: detail.provider, scope: detail.scope }],
  im_binding_details: [detail],
}
function setup(
  context: ContactsFeatureContextValue = managerContext,
  contact: ContactView = workspaceContact,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <ContactsManagementProvider context={context}>
        <ContactDetailsPanel
          contact={contact}
          onClose={vi.fn()}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />
      </ContactsManagementProvider>
    </QueryClientProvider>,
  )
}
beforeEach(() => {
  api.channels.mockReset().mockResolvedValue({ channels: [channel] })
  api.identities.mockReset().mockResolvedValue({ data: [identity], page: 1, limit: 20, total: 1 })
  api.bind.mockReset().mockResolvedValue({ contact: workspaceContact })
  api.override.mockReset().mockResolvedValue({ contact: workspaceContact })
  api.unbind.mockReset().mockResolvedValue({})
  api.reset.mockReset().mockResolvedValue({})
})

it.each([true, undefined])(
  'never calls workspace channel management while centralized capability=%s',
  async (imCentrallyManaged) => {
    setup({ ...managerContext, imCentrallyManaged })
    expect(screen.getByRole('region', { name: 'Alice' })).toBeInTheDocument()
    await Promise.resolve()
    expect(api.channels).not.toHaveBeenCalled()
  },
)

it('keeps external contacts email-only even when a channel is configured', () => {
  setup(managerContext, alice)
  expect(screen.queryByRole('button', { name: /imBinding.changeTitle/ })).not.toBeInTheDocument()
  expect(api.channels).not.toHaveBeenCalled()
})

it('offers an initially unbound workspace contact a provider-described bind action', async () => {
  setup(managerContext, { ...workspaceContact, im_bindings: [], im_binding_details: [] })
  const bind = await screen.findByRole('button', { name: 'contacts.imBinding.bind' })
  expect(bind).toHaveAccessibleDescription('Feishu')
})

it('unbinds a default identity through the generated delete operation', async () => {
  const user = userEvent.setup()
  setup()
  await user.click(screen.getByRole('button', { name: /imBinding.changeTitle.*Feishu/ }))
  const dialog = await screen.findByRole('dialog')
  await user.click(within(dialog).getByRole('button', { name: 'contacts.imBinding.remove' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(api.unbind).toHaveBeenCalledWith({ params: { contact_id: alice.id } })
  expect(api.reset).not.toHaveBeenCalled()
})

it('exposes centralized binding modes with an associated organization identity preview', async () => {
  const user = userEvent.setup()
  setup({ ...managerContext, imCentrallyManaged: true })
  await user.click(screen.getByRole('button', { name: /imBinding.changeTitle.*Feishu/ }))
  const group = await screen.findByRole('radiogroup', { name: 'contacts.imBinding.modeLabel' })
  const organization = within(group).getByRole('radio', {
    name: 'contacts.imBinding.organizationMode',
  })
  expect(organization).toBeChecked()
  expect(organization).toHaveAccessibleDescription(/Alice IM/)
  expect(api.channels).not.toHaveBeenCalled()
})

it('restores an override with the override delete operation instead of unbinding the default', async () => {
  const user = userEvent.setup()
  const overridden = { ...detail, scope: 'workspace' as const }
  setup(
    { ...managerContext, imCentrallyManaged: true },
    {
      ...workspaceContact,
      im_bindings: [{ id: detail.id, provider: 'feishu', scope: 'workspace' }],
      im_binding_details: [overridden],
    },
  )
  await user.click(screen.getByRole('button', { name: /imBinding.changeTitle.*Feishu/ }))
  await user.click(
    await screen.findByRole('radio', { name: 'contacts.imBinding.organizationMode' }),
  )
  await user.click(screen.getByRole('button', { name: 'contacts.imBinding.saveBinding' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(api.reset).toHaveBeenCalledWith({ params: { contact_id: alice.id } })
  expect(api.unbind).not.toHaveBeenCalled()
})
