import type {
  GetContactResponse,
  HumanInputContact,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { ReactNode } from 'react'
import type { ContactsFeatureContextValue } from '../types'
import { QueryClient } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { createDeferred } from '@/test/deferred'
import { ContactsManagementProvider } from '../composition'
import { ContactsDirectoryPage } from '../directory-page'
import { alice, bob, managerContext } from './fixtures/data'

const api = vi.hoisted(() => ({
  list: vi.fn(),
  details: vi.fn(),
  remove: vi.fn(),
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
      'workspaces.current.humanInput.v2.contacts.get': api.list,
      'workspaces.current.humanInput.v2.contacts.byContactId.get': api.details,
      'workspaces.current.humanInput.v2.contacts.remove.post': api.remove,
      'workspaces.current.humanInput.v2.channels.get': api.channels,
      'workspaces.current.humanInput.v2.imIdentities.get': api.identities,
      'workspaces.current.humanInput.v2.contacts.byContactId.imBindings.put': api.bind,
      'workspaces.current.humanInput.v2.contacts.byContactId.imOverride.put': api.override,
      'workspaces.current.humanInput.v2.contacts.byContactId.imBindings.delete': api.unbind,
      'workspaces.current.humanInput.v2.contacts.byContactId.imOverride.delete': api.reset,
    }),
  }
})

let contacts: HumanInputContact[]
function setup(context: ContactsFeatureContextValue = managerContext, searchParams = '') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const onUrlUpdate = vi.fn()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientTestProvider queryClient={queryClient}>
      <NuqsTestingAdapter searchParams={searchParams} hasMemory onUrlUpdate={onUrlUpdate}>
        <ContactsManagementProvider context={context}>{children}</ContactsManagementProvider>
      </NuqsTestingAdapter>
    </QueryClientTestProvider>
  )
  const view = render(<ContactsDirectoryPage />, { wrapper })
  return { ...view, queryClient, onUrlUpdate }
}
beforeEach(() => {
  contacts = structuredClone([alice, bob])
  api.list
    .mockReset()
    .mockImplementation(
      async ({
        query,
      }: { query?: { group?: string; keyword?: string; page?: number; limit?: number } } = {}) => {
        const data = contacts.filter(
          (contact) =>
            (!query?.group || contact.type === query.group) &&
            (!query?.keyword || `${contact.name} ${contact.email}`.includes(query.keyword)),
        )
        const limit = query?.limit ?? 20
        const page = query?.page ?? 1
        return {
          data: data.slice((page - 1) * limit, page * limit),
          limit,
          page,
          total: data.length,
        }
      },
    )
  api.details
    .mockReset()
    .mockImplementation(async ({ params }: { params: { contact_id: string } }) => ({
      contact: contacts.find((contact) => contact.id === params.contact_id)!,
      im_binding_details: [],
    }))
  api.remove
    .mockReset()
    .mockImplementation(async ({ body }: { body: { contact_ids: string[] } }) => {
      contacts = contacts.filter((contact) => !body.contact_ids.includes(contact.id))
      return { removed_contact_ids: body.contact_ids }
    })
  api.channels.mockReset().mockResolvedValue({ channels: [] })
  api.identities.mockReset().mockResolvedValue({ data: [], total: 0, limit: 20, page: 1 })
})

it('names the table, exposes contact emails and channel names, and omits a nested main', async () => {
  contacts[0] = {
    ...alice,
    im_bindings: [{ id: 'binding-1', provider: 'slack', scope: 'workspace' }],
  }
  setup()
  const table = await screen.findByRole('table', { name: 'contacts.directory.title' })
  expect(screen.queryByRole('main')).not.toBeInTheDocument()
  expect(within(table).getByRole('button', { name: /Alice alice@example.com/ })).toBeInTheDocument()
  expect(within(table).getByRole('img', { name: 'Slack' })).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /learnMore/ })).not.toBeInTheDocument()
})

it.each([false, true])(
  'moves focus into details and returns to the row when centralized=%s',
  async (centrallyManaged) => {
    const user = userEvent.setup()
    setup({ ...managerContext, imCentrallyManaged: centrallyManaged })
    const trigger = await screen.findByRole('button', { name: /Alice alice@example.com/ })
    await user.click(trigger)
    const heading = await screen.findByRole('heading', { name: 'Alice' })
    await waitFor(() => expect(heading).toHaveFocus())
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    const panel = screen.getByRole('region', { name: 'Alice' })
    await user.click(within(panel).getByRole('button', { name: 'contacts.action.close' }))
    await waitFor(() => expect(trigger).toHaveFocus())
    if (centrallyManaged) expect(api.channels).not.toHaveBeenCalled()
  },
)

it('returns focus to search when closing a deep-linked contact without an opening row', async () => {
  const user = userEvent.setup()
  setup(managerContext, `?contact_id=${alice.id}`)
  const panel = await screen.findByRole('region', { name: 'Alice' })
  await user.click(within(panel).getByRole('button', { name: 'contacts.action.close' }))
  await waitFor(() =>
    expect(screen.getByRole('searchbox', { name: 'contacts.directory.search' })).toHaveFocus(),
  )
})

it('focuses a surviving row after a single removal and names only the removal target', async () => {
  const user = userEvent.setup()
  setup()
  await user.click(await screen.findByRole('button', { name: /Alice alice@example.com/ }))
  await user.click(screen.getByRole('button', { name: 'contacts.details.more' }))
  await user.click(await screen.findByRole('menuitem', { name: 'contacts.details.remove' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog).toHaveTextContent('contacts.directory.removalSingleTitle')
  await user.click(
    within(dialog).getByRole('button', { name: 'contacts.directory.removeSelected' }),
  )
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  expect(api.remove).toHaveBeenCalledWith({ body: { contact_ids: [alice.id] } })
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /Bob bob@example.com/ })).toHaveFocus(),
  )
})

it('moves focus before clearing selection and reports selection through one stable status', async () => {
  const user = userEvent.setup()
  setup()
  const status = screen.getByRole('status')
  await user.click(await screen.findByRole('checkbox', { name: /selectContact.*Alice/ }))
  expect(screen.getByRole('status')).toBe(status)
  expect(status).toHaveTextContent('contacts.platformPicker.selected')
  await user.click(screen.getByRole('button', { name: 'contacts.directory.cancelSelection' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /Alice alice@example.com/ })).toHaveFocus(),
  )
})

it('keeps a failed bulk selection and restores focus to search after removing the final rows', async () => {
  const user = userEvent.setup()
  api.remove.mockRejectedValueOnce(new Error('Unavailable'))
  setup()
  const selection = await screen.findByRole('checkbox', { name: 'contacts.directory.selectAll' })
  await user.click(selection)
  await user.click(screen.getByRole('button', { name: 'contacts.directory.removeSelected' }))
  const dialog = await screen.findByRole('alertdialog')
  const confirm = within(dialog).getByRole('button', { name: 'contacts.directory.removeSelected' })
  await user.click(confirm)
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    'contacts.directory.removalFailed',
  )
  expect(selection).toBeChecked()
  await user.click(confirm)
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  await waitFor(() =>
    expect(screen.getByRole('searchbox', { name: 'contacts.directory.search' })).toHaveFocus(),
  )
})

it('renders the page h1 while denied or resolving capabilities without fetching contacts', () => {
  const { rerender } = setup({ ...managerContext, imCentrallyManaged: undefined })
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('contacts.directory.title')
  expect(api.list).not.toHaveBeenCalled()
  rerender(<ContactsDirectoryPage />)
})

it('does not restore URL page counts by repeatedly fetching old pages', async () => {
  setup(managerContext, '?contact_pages=10')
  await screen.findByRole('table')
  const directoryCalls = api.list.mock.calls.filter(([input]) => input.query.limit === 20)
  expect(directoryCalls).toHaveLength(1)
})

it('mounts a separate alert when contact details fail', async () => {
  const request = createDeferred<GetContactResponse>()
  api.details.mockReturnValueOnce(request.promise)
  const user = userEvent.setup()
  setup()
  await user.click(await screen.findByRole('button', { name: /Alice alice@example.com/ }))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  await act(async () => request.reject(new Error('Unavailable')))
  expect(await screen.findByRole('alert')).toHaveTextContent('contacts.details.error')
})
