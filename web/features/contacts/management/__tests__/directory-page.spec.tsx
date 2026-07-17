import type { ReactNode } from 'react'
import type { ContactsMockScenarioDefinition } from '../mock/scenarios'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { ContactsManagementMockProvider } from '../composition'
import { ContactsDirectoryPage } from '../directory-page'
import { ContactsMockScenario, createContactsMockScenario } from '../mock/scenarios'

function renderDirectory(scenario: ContactsMockScenarioDefinition, searchParams = '') {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  })
  const onUrlUpdate = vi.fn()
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <NuqsTestingAdapter hasMemory searchParams={searchParams} onUrlUpdate={onUrlUpdate}>
          <ContactsManagementMockProvider scenario={scenario}>
            {children}
          </ContactsManagementMockProvider>
        </NuqsTestingAdapter>
      </QueryClientProvider>
    )
  }

  return { onUrlUpdate, queryClient, ...render(<ContactsDirectoryPage />, { wrapper: Wrapper }) }
}

describe('ContactsDirectoryPage', () => {
  it('renders all three EE contact kinds and restores contact_id details', async () => {
    renderDirectory(
      createContactsMockScenario(ContactsMockScenario.EeMixed),
      '?contact_id=contact-platform',
    )

    expect(await screen.findByText('Ralph Edwards')).toBeInTheDocument()
    expect(screen.getAllByText('Leslie Alexander')).toHaveLength(2)
    expect(screen.getByText('Courtney Henry')).toBeInTheDocument()
    const details = await screen.findByRole('complementary', {
      name: 'contacts.details.title',
    })
    expect(details).toHaveTextContent('org-user-platform')
    expect(details).not.toHaveTextContent('contacts.imPlatform.title')
  })

  it('renders workspace and External type-specific details without unsupported actions', async () => {
    const workspaceView = renderDirectory(
      createContactsMockScenario(ContactsMockScenario.EeMixed),
      '?contact_id=contact-owner',
    )
    let details = await screen.findByRole('complementary', { name: 'contacts.details.title' })
    expect(await within(details).findByText('Admin')).toBeInTheDocument()
    expect(details).toHaveTextContent('Slack')
    expect(within(details).queryByRole('button', { name: /edit|remove/i })).not.toBeInTheDocument()
    workspaceView.unmount()

    renderDirectory(
      createContactsMockScenario(ContactsMockScenario.EeMixed),
      '?contact_id=contact-external',
    )
    details = await screen.findByRole('complementary', { name: 'contacts.details.title' })
    expect(await within(details).findByText('contacts.details.emailOnly')).toBeInTheDocument()
    expect(details).toHaveTextContent('contacts.details.notDifyAccount')
    expect(details).toHaveTextContent('contacts.details.currentWorkspaceOnly')
    expect(details).toHaveTextContent('external@example.com')
  })

  it('preserves list context and restores row focus after closing details', async () => {
    const user = userEvent.setup()
    renderDirectory(
      createContactsMockScenario(ContactsMockScenario.CeMixed),
      '?contact_kind=external&contact_search=Courtney',
    )
    const search = screen.getByRole('textbox', { name: 'contacts.directory.search' })
    const row = await screen.findByRole('button', { name: /Courtney Henry/ })
    await user.click(row)
    const details = await screen.findByRole('complementary', { name: 'contacts.details.title' })
    await user.click(within(details).getByRole('button', { name: 'contacts.action.close' }))

    await waitFor(() => expect(row).toHaveFocus())
    expect(search).toHaveValue('Courtney')
    expect(screen.getByRole('button', { name: 'contacts.filter.external' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('distinguishes detail load failure, missing values, and not found', async () => {
    const failed = renderDirectory(
      createContactsMockScenario(ContactsMockScenario.DetailFailure),
      '?contact_id=contact-owner',
    )
    expect(await screen.findByText('contacts.details.error')).toBeInTheDocument()
    failed.unmount()

    const missingScenario = createContactsMockScenario(ContactsMockScenario.EeMixed)
    missingScenario.contacts = missingScenario.contacts.map((contact) =>
      contact.kind === 'platform' ? { ...contact, sourceWorkspaceSummary: null } : contact,
    )
    const missing = renderDirectory(missingScenario, '?contact_id=contact-platform')
    expect(await screen.findByText('contacts.details.missing')).toBeInTheDocument()
    missing.unmount()

    renderDirectory(
      createContactsMockScenario(ContactsMockScenario.EeMixed),
      '?contact_id=contact-missing',
    )
    expect(await screen.findByText('contacts.details.notFound')).toBeInTheDocument()
  })

  it('filters the directory and exposes a recoverable no-result state', async () => {
    const user = userEvent.setup()
    const { onUrlUpdate } = renderDirectory(
      createContactsMockScenario(ContactsMockScenario.CeMixed),
    )
    await screen.findByText('Ralph Edwards')

    await user.click(screen.getByRole('button', { name: 'contacts.filter.external' }))
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByText('Ralph Edwards')).not.toBeInTheDocument())
    expect(screen.getByText('Courtney Henry')).toBeInTheDocument()

    await user.type(screen.getByRole('textbox', { name: 'contacts.directory.search' }), 'missing')
    expect(await screen.findByText('contacts.directory.noResultsTitle')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'contacts.action.clearFilters' }))
    expect(await screen.findByText('Ralph Edwards')).toBeInTheDocument()
  })

  it('validates, classifies conflicts, and creates an External contact without a request', async () => {
    const user = userEvent.setup()
    renderDirectory(createContactsMockScenario(ContactsMockScenario.CeMixed))
    await screen.findByText('Ralph Edwards')

    await user.click(screen.getByRole('button', { name: 'contacts.directory.addExternal' }))
    const dialog = screen.getByRole('dialog', { name: 'contacts.external.title' })
    await user.type(
      within(dialog).getByRole('textbox', { name: 'contacts.external.name' }),
      'Duplicate',
    )
    await user.type(
      within(dialog).getByRole('textbox', { name: 'contacts.external.email' }),
      'EXTERNAL@EXAMPLE.COM',
    )
    await user.click(within(dialog).getByRole('button', { name: 'contacts.external.add' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'contacts.external.result.duplicate_external_contact',
    )

    await user.clear(within(dialog).getByRole('textbox', { name: 'contacts.external.name' }))
    await user.type(
      within(dialog).getByRole('textbox', { name: 'contacts.external.name' }),
      'New Partner',
    )
    await user.clear(within(dialog).getByRole('textbox', { name: 'contacts.external.email' }))
    await user.type(
      within(dialog).getByRole('textbox', { name: 'contacts.external.email' }),
      'partner@example.com',
    )
    await user.click(within(dialog).getByRole('button', { name: 'contacts.external.add' }))

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'contacts.external.title' }),
      ).not.toBeInTheDocument(),
    )
    expect(await screen.findByText('New Partner')).toBeInTheDocument()
  })

  it('associates External contact validation and restores focus after cancel', async () => {
    const user = userEvent.setup()
    renderDirectory(createContactsMockScenario(ContactsMockScenario.CeMixed))
    await screen.findByText('Ralph Edwards')
    const trigger = screen.getByRole('button', { name: 'contacts.directory.addExternal' })
    await user.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'contacts.external.title' })
    await user.click(within(dialog).getByRole('button', { name: 'contacts.external.add' }))
    expect(
      await within(dialog).findByText('contacts.external.validation.name_required'),
    ).toBeInTheDocument()

    await user.type(
      within(dialog).getByRole('textbox', { name: 'contacts.external.name' }),
      'Partner',
    )
    await user.type(
      within(dialog).getByRole('textbox', { name: 'contacts.external.email' }),
      'invalid',
    )
    await user.click(within(dialog).getByRole('button', { name: 'contacts.external.add' }))
    expect(
      await within(dialog).findByText('contacts.external.validation.email_invalid'),
    ).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'contacts.action.cancel' }))
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('preserves the External contact draft after a recoverable mock failure', async () => {
    const user = userEvent.setup()
    renderDirectory(createContactsMockScenario(ContactsMockScenario.ExternalFailure))
    await screen.findByText('Ralph Edwards')
    await user.click(screen.getByRole('button', { name: 'contacts.directory.addContact' }))
    await user.click(screen.getByRole('menuitem', { name: 'contacts.directory.addExternal' }))
    const dialog = screen.getByRole('dialog', { name: 'contacts.external.title' })
    const name = within(dialog).getByRole('textbox', { name: 'contacts.external.name' })
    const email = within(dialog).getByRole('textbox', { name: 'contacts.external.email' })
    await user.type(name, 'Recoverable Partner')
    await user.type(email, 'recoverable@example.com')
    await user.click(within(dialog).getByRole('button', { name: 'contacts.external.add' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'contacts.external.result.failed',
    )
    expect(name).toHaveValue('Recoverable Partner')
    expect(email).toHaveValue('recoverable@example.com')
  })

  it('adds multiple EE Organization candidates while excluding existing contacts', async () => {
    const user = userEvent.setup()
    renderDirectory(createContactsMockScenario(ContactsMockScenario.EeMixed))
    await screen.findByText('Ralph Edwards')

    await user.click(screen.getByRole('button', { name: 'contacts.directory.addContact' }))
    await user.click(screen.getByRole('menuitem', { name: 'contacts.directory.addFromPlatform' }))
    const dialog = screen.getByRole('dialog', { name: 'contacts.organization.title' })
    expect(within(dialog).queryByText('owner@example.com')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('checkbox', { name: /Ada Lovelace/ }))
    await user.click(within(dialog).getByRole('checkbox', { name: /Grace Hopper/ }))
    await user.click(within(dialog).getByRole('button', { name: 'contacts.organization.add' }))

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument()
  })

  it('keeps Organization selection after a recoverable add failure', async () => {
    const user = userEvent.setup()
    renderDirectory(createContactsMockScenario(ContactsMockScenario.AddPlatformFailure))
    await screen.findByText('Ralph Edwards')
    await user.click(screen.getByRole('button', { name: 'contacts.directory.addContact' }))
    await user.click(screen.getByRole('menuitem', { name: 'contacts.directory.addFromPlatform' }))
    const dialog = screen.getByRole('dialog', { name: 'contacts.organization.title' })
    const candidate = await within(dialog).findByRole('checkbox', { name: /Ada Lovelace/ })
    await user.click(candidate)
    await user.click(within(dialog).getByRole('button', { name: 'contacts.organization.add' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'contacts.organization.addFailed',
    )
    expect(candidate).toBeChecked()
    expect(screen.queryByText('contact-platform-org-candidate-ada')).not.toBeInTheDocument()
  })

  it('shows a retryable Organization candidate query failure', async () => {
    const user = userEvent.setup()
    renderDirectory(createContactsMockScenario(ContactsMockScenario.OrganizationFailure))
    await screen.findByText('Ralph Edwards')
    await user.click(screen.getByRole('button', { name: 'contacts.directory.addContact' }))
    await user.click(screen.getByRole('menuitem', { name: 'contacts.directory.addFromPlatform' }))
    const dialog = screen.getByRole('dialog', { name: 'contacts.organization.title' })

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'contacts.organization.error',
    )
    expect(
      within(dialog).getByRole('button', { name: 'contacts.action.retry' }),
    ).toBeInTheDocument()
  })

  it('does not render contact data without view permission', () => {
    renderDirectory(createContactsMockScenario(ContactsMockScenario.NoAccess))

    expect(screen.getByText('contacts.directory.noAccessTitle')).toBeInTheDocument()
    expect(screen.queryByText('Ralph Edwards')).not.toBeInTheDocument()
  })

  it('distinguishes an empty directory, a read-only role, and an initial failure', async () => {
    const { unmount } = renderDirectory(createContactsMockScenario(ContactsMockScenario.Empty))
    expect(await screen.findByText('contacts.directory.emptyTitle')).toBeInTheDocument()
    unmount()

    const readOnly = renderDirectory(createContactsMockScenario(ContactsMockScenario.ReadOnly))
    expect(await screen.findByText('Ralph Edwards')).toBeInTheDocument()
    expect(screen.getByText('contacts.directory.viewOnly')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'contacts.directory.addContact' }),
    ).not.toBeInTheDocument()
    readOnly.unmount()

    renderDirectory(createContactsMockScenario(ContactsMockScenario.DirectoryFailure))
    expect(await screen.findByText('contacts.directory.errorTitle')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'contacts.action.retry' })).toBeInTheDocument()
  })

  it('keeps loaded rows when the next page fails', async () => {
    const user = userEvent.setup()
    renderDirectory(createContactsMockScenario(ContactsMockScenario.NextPageFailure))
    expect(await screen.findByText('Ralph Edwards')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'contacts.action.loadMore' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('contacts.directory.pageError')
    expect(screen.getByText('Ralph Edwards')).toBeInTheDocument()
  })
})
