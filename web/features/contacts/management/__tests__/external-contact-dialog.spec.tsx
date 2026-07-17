import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ContactsManagementMockProvider } from '../composition'
import { ExternalContactDialog } from '../external-contact-dialog'
import { ContactsMockScenario, createContactsMockScenario } from '../mock/scenarios'

describe('ExternalContactDialog pending state', () => {
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
})
