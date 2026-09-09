import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleClient } from '@/service/client'
import { ContactsManagementMockProvider, ContactsManagementProvider } from '../composition'
import { ExternalContactDialog } from '../external-contact-dialog'
import { ContactsMockScenario, createContactsMockScenario } from '../mock/scenarios'
import { createContactsApiRepository } from '../repository'

vi.mock('@/service/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/client')>()),
  consoleClient: {
    workspaces: {
      current: {
        humanInput: {
          contacts: {
            get: vi.fn(),
            byContactId: { get: vi.fn() },
            external: { post: vi.fn(), byContactId: { patch: vi.fn() } },
            remove: { post: vi.fn() },
          },
        },
      },
    },
  },
}))

describe('ExternalContactDialog pending state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    ['external@example.com', 'duplicate_external_contact'],
    ['owner@example.com', 'matches_workspace_contact'],
    ['platform@example.com', 'matches_platform_contact'],
  ] as const)('renders the typed %s conflict result', async (email, resultKind) => {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <ContactsManagementMockProvider
          scenario={createContactsMockScenario(ContactsMockScenario.EeMixed)}
        >
          <ExternalContactDialog open onCreated={vi.fn()} onOpenChange={vi.fn()} />
        </ContactsManagementMockProvider>
      </QueryClientProvider>,
    )
    const user = userEvent.setup()
    const dialog = screen.getByRole('dialog', { name: 'contacts.external.title' })
    await user.type(
      within(dialog).getByRole('textbox', { name: 'contacts.external.name' }),
      'Conflict',
    )
    await user.type(
      within(dialog).getByRole('textbox', { name: 'contacts.external.email' }),
      email.toUpperCase(),
    )
    await user.click(within(dialog).getByRole('button', { name: 'contacts.external.add' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      `contacts.external.result.${resultKind}`,
    )
  })

  it('prevents duplicate submission and never issues a real request', async () => {
    let resolveCreate: (() => void) | undefined
    const wait = () =>
      new Promise<void>((resolve) => {
        resolveCreate = resolve
      })
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    })
    const onCreated = vi.fn()
    const onOpenChange = vi.fn()
    vi.mocked(globalThis.fetch).mockClear()
    render(
      <QueryClientProvider client={queryClient}>
        <ContactsManagementMockProvider
          scenario={createContactsMockScenario(ContactsMockScenario.CeMixed)}
          wait={wait}
        >
          <ExternalContactDialog open onCreated={onCreated} onOpenChange={onOpenChange} />
        </ContactsManagementMockProvider>
      </QueryClientProvider>,
    )
    const user = userEvent.setup()
    const dialog = screen.getByRole('dialog', { name: 'contacts.external.title' })
    await user.type(
      within(dialog).getByRole('textbox', { name: 'contacts.external.name' }),
      'Partner',
    )
    await user.type(
      within(dialog).getByRole('textbox', { name: 'contacts.external.email' }),
      'new@example.com',
    )
    await user.click(within(dialog).getByRole('button', { name: 'contacts.external.add' }))

    expect(
      within(dialog).getByRole('button', { name: 'contacts.external.adding' }),
    ).toHaveAttribute('aria-disabled', 'true')
    expect(onCreated).not.toHaveBeenCalled()
    expect(globalThis.fetch).not.toHaveBeenCalled()
    await act(async () => resolveCreate?.())
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('contact-external-created-1'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('retains the draft after an API failure and closes only after a successful retry', async () => {
    const createContact = vi.mocked(
      consoleClient.workspaces.current.humanInput.contacts.external.post,
    )
    createContact.mockRejectedValueOnce(
      Object.assign(new Error('Service unavailable'), { status: 503 }),
    )
    createContact.mockResolvedValueOnce({
      contact: {
        avatar_url: '',
        created_at: 1_778_000_000,
        email: 'partner@example.com',
        id: 'server-created-contact',
        name: 'Partner',
        type: 'external',
      },
    })
    const scenario = createContactsMockScenario(ContactsMockScenario.CeMixed)
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    })
    const onCreated = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <QueryClientProvider client={queryClient}>
        <ContactsManagementProvider
          context={{
            deployment: scenario.deployment,
            permissions: scenario.permissions,
            workspaceId: scenario.workspaceId,
          }}
          repository={createContactsApiRepository()}
        >
          <ExternalContactDialog open onCreated={onCreated} onOpenChange={onOpenChange} />
        </ContactsManagementProvider>
      </QueryClientProvider>,
    )
    const user = userEvent.setup()
    const dialog = screen.getByRole('dialog', { name: 'contacts.external.title' })
    const name = within(dialog).getByRole('textbox', { name: 'contacts.external.name' })
    const email = within(dialog).getByRole('textbox', { name: 'contacts.external.email' })
    await user.type(name, 'Partner')
    await user.type(email, 'partner@example.com')
    await user.click(within(dialog).getByRole('button', { name: 'contacts.external.add' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'contacts.external.result.failed',
    )
    expect(name).toHaveValue('Partner')
    expect(email).toHaveValue('partner@example.com')
    expect(onCreated).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'contacts.external.add' }))

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('server-created-contact'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(createContact).toHaveBeenCalledTimes(2)
  })
})
