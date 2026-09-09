import type { ReactNode } from 'react'
import type { ContactsMockScenarioDefinition } from '../mock/scenarios'
import type { ContactsManagementRepository } from '../repository'
import type { ContactView } from '../types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { ContactsManagementMockProvider, ContactsManagementProvider } from '../composition'
import { ContactsDirectoryPage } from '../directory-page'
import { createContactsMockRepository } from '../mock/repository'
import { ContactsMockScenario, createContactsMockScenario } from '../mock/scenarios'

function renderDirectory(
  scenario: ContactsMockScenarioDefinition,
  searchParams = '',
  repository?: ContactsManagementRepository,
) {
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
          {repository ? (
            <ContactsManagementProvider
              context={{
                deployment: scenario.deployment,
                permissions: scenario.permissions,
                workspaceId: scenario.workspaceId,
              }}
              repository={repository}
            >
              {children}
            </ContactsManagementProvider>
          ) : (
            <ContactsManagementMockProvider scenario={scenario}>
              {children}
            </ContactsManagementMockProvider>
          )}
        </NuqsTestingAdapter>
      </QueryClientProvider>
    )
  }

  return { onUrlUpdate, queryClient, ...render(<ContactsDirectoryPage />, { wrapper: Wrapper }) }
}

async function findLoadedDetails(content: string) {
  await waitFor(() => {
    expect(screen.getByRole('complementary', { name: 'contacts.details.title' })).toHaveTextContent(
      content,
    )
  })
  return screen.getByRole('complementary', { name: 'contacts.details.title' })
}

describe('ContactsDirectoryPage', () => {
  it('renders API timestamps expressed in Unix seconds', async () => {
    const scenario = createContactsMockScenario(ContactsMockScenario.EeMixed)
    const firstContact = scenario.contacts[0]!
    firstContact.created_at = Math.floor(Date.now() / 1000) - 5 * 60 * 60

    renderDirectory(scenario)

    expect(await screen.findByText('5 hours ago')).toBeInTheDocument()
  })

  it('renders all three contact types and restores details from the loaded list', async () => {
    renderDirectory(
      createContactsMockScenario(ContactsMockScenario.EeMixed),
      '?contact_id=contact-platform',
    )

    expect(await screen.findByText('Ralph Edwards')).toBeInTheDocument()
    expect(screen.getAllByText('Leslie Alexander')).toHaveLength(2)
    expect(screen.getByText('Courtney Henry')).toBeInTheDocument()
    const details = await findLoadedDetails('Leslie Alexander')
    expect(details).toHaveTextContent('contacts.type.platform')
    expect(details).not.toHaveTextContent('org-user-platform')
    expect(details).not.toHaveTextContent('contacts.imPlatform.title')
  })

  it('renders common list fields and the contact type without type-specific identities', async () => {
    const workspaceView = renderDirectory(
      createContactsMockScenario(ContactsMockScenario.EeMixed),
      '?contact_id=contact-owner',
    )
    let details = await findLoadedDetails('owner@example.com')
    expect(details).toHaveTextContent('owner@example.com')
    expect(details).toHaveTextContent('contacts.type.workspace')
    expect(details).toHaveTextContent('Slack')
    expect(within(details).queryByRole('button', { name: /edit|remove/i })).not.toBeInTheDocument()
    workspaceView.unmount()

    renderDirectory(
      createContactsMockScenario(ContactsMockScenario.EeMixed),
      '?contact_id=contact-external',
    )
    details = await findLoadedDetails('external@example.com')
    expect(details).toHaveTextContent('external@example.com')
    expect(details).toHaveTextContent('contacts.type.external')
    expect(details).not.toHaveTextContent('contacts.details.emailOnly')
  })

  it('edits an External contact from the details action menu', async () => {
    const user = userEvent.setup()
    renderDirectory(
      createContactsMockScenario(ContactsMockScenario.EeMixed),
      '?contact_id=contact-external',
    )
    const details = await findLoadedDetails('Courtney Henry')

    await user.click(within(details).getByRole('button', { name: 'contacts.details.more' }))
    await user.click(screen.getByRole('menuitem', { name: 'contacts.details.edit' }))
    const dialog = screen.getByRole('dialog', { name: 'contacts.external.editTitle' })
    const name = within(dialog).getByRole('textbox', { name: 'contacts.external.name' })
    expect(name).toHaveValue('Courtney Henry')
    await user.clear(name)
    await user.type(name, 'Courtney Cooper')
    await user.click(within(dialog).getByRole('button', { name: 'contacts.external.save' }))

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'contacts.external.editTitle' }),
      ).not.toBeInTheDocument(),
    )
    expect(await screen.findAllByText('Courtney Cooper')).toHaveLength(2)
  })

  it('removes a non-workspace contact from the details action menu', async () => {
    const user = userEvent.setup()
    renderDirectory(
      createContactsMockScenario(ContactsMockScenario.EeMixed),
      '?contact_id=contact-external',
    )
    const details = await findLoadedDetails('Courtney Henry')

    await user.click(within(details).getByRole('button', { name: 'contacts.details.more' }))
    await user.click(screen.getByRole('menuitem', { name: 'contacts.details.remove' }))

    await waitFor(() => expect(screen.queryByText('Courtney Henry')).not.toBeInTheDocument())
    expect(
      screen.queryByRole('complementary', { name: 'contacts.details.title' }),
    ).not.toBeInTheDocument()
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

  it('does not resend an ID removed from details in the next batch removal', async () => {
    const scenario = createContactsMockScenario(ContactsMockScenario.EeMixed)
    const repository = createContactsMockRepository({ scenario })
    const removeContacts = vi.spyOn(repository, 'removeContacts')
    const user = userEvent.setup()
    renderDirectory(scenario, '', repository)
    await screen.findByText('Courtney Henry')

    await user.click(screen.getByRole('checkbox', { name: /Courtney Henry/ }))
    await user.click(screen.getByRole('button', { name: /Courtney Henry/ }))
    const details = await findLoadedDetails('Courtney Henry')
    await user.click(within(details).getByRole('button', { name: 'contacts.details.more' }))
    await user.click(screen.getByRole('menuitem', { name: 'contacts.details.remove' }))
    await waitFor(() => expect(screen.queryByText('Courtney Henry')).not.toBeInTheDocument())
    await user.click(screen.getByRole('checkbox', { name: /Leslie Alexander/ }))
    await user.click(screen.getByRole('button', { name: 'contacts.directory.removeSelected' }))

    await waitFor(() => expect(removeContacts).toHaveBeenCalledTimes(2))
    expect(removeContacts).toHaveBeenNthCalledWith(1, { contactIds: ['contact-external'] })
    expect(removeContacts).toHaveBeenNthCalledWith(2, { contactIds: ['contact-platform'] })
  })

  it('shows not-found details for a deleted contact while retaining the directory', async () => {
    renderDirectory(
      createContactsMockScenario(ContactsMockScenario.EeMixed),
      '?contact_id=contact-missing',
    )
    expect(await screen.findByText('Ralph Edwards')).toBeInTheDocument()
    expect(await screen.findByText('contacts.details.notFound')).toBeInTheDocument()
    expect(screen.getByText('Courtney Henry')).toBeInTheDocument()
  })

  it('loads a URL-selected contact independently of filtered rows and shows its loading state', async () => {
    const scenario = createContactsMockScenario(ContactsMockScenario.EeMixed)
    const repository = createContactsMockRepository({ scenario })
    let finishDetails: ((contact: ContactView | null) => void) | undefined
    const getContact = vi.spyOn(repository, 'getContact').mockImplementation(
      () =>
        new Promise((resolve) => {
          finishDetails = resolve
        }),
    )
    const platform = scenario.contacts.find((contact) => contact.id === 'contact-platform')!
    renderDirectory(
      scenario,
      '?contact_id=contact-platform&contact_kind=external&contact_search=Courtney',
      repository,
    )

    await waitFor(() => expect(getContact).toHaveBeenCalledWith('contact-platform'))
    expect(await screen.findByText('Courtney Henry')).toBeInTheDocument()
    expect(screen.getByText('contacts.details.loading')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Leslie Alexander/ })).not.toBeInTheDocument()

    await act(async () => finishDetails?.(platform))

    const details = await findLoadedDetails('Leslie Alexander')
    expect(within(details).getByText('Leslie Alexander')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'contacts.directory.search' })).toHaveValue(
      'Courtney',
    )
    expect(screen.getByRole('button', { name: 'contacts.filter.external' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('retries unavailable contact details without replacing the error with stale list data', async () => {
    const scenario = createContactsMockScenario(ContactsMockScenario.EeMixed)
    const repository = createContactsMockRepository({ scenario })
    const platform = scenario.contacts.find((contact) => contact.id === 'contact-platform')!
    const getContact = vi
      .spyOn(repository, 'getContact')
      .mockRejectedValueOnce(new Error('Details unavailable'))
      .mockResolvedValueOnce(platform)
    const user = userEvent.setup()
    renderDirectory(scenario, '?contact_id=contact-platform&contact_kind=external', repository)

    expect(await screen.findByText('contacts.details.error')).toBeInTheDocument()
    expect(screen.getByText('Courtney Henry')).toBeInTheDocument()
    expect(screen.queryByText('contacts.details.notFound')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'contacts.action.retry' }))

    expect(await screen.findByText('Leslie Alexander')).toBeInTheDocument()
    expect(getContact).toHaveBeenCalledTimes(2)
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
    expect(await screen.findByRole('button', { name: /New Partner/ })).toBeInTheDocument()
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

  it('adds multiple available Platform contacts while excluding existing contacts', async () => {
    const user = userEvent.setup()
    renderDirectory(createContactsMockScenario(ContactsMockScenario.EeMixed))
    await screen.findByText('Ralph Edwards')

    await user.click(screen.getByRole('button', { name: 'contacts.directory.addContact' }))
    await user.click(screen.getByRole('menuitem', { name: 'contacts.directory.addFromPlatform' }))
    const dialog = screen.getByRole('dialog', { name: 'contacts.platformPicker.title' })
    expect(within(dialog).queryByText('owner@example.com')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('checkbox', { name: /Ada Lovelace/ }))
    await user.click(within(dialog).getByRole('checkbox', { name: /Grace Hopper/ }))
    await user.click(within(dialog).getByRole('button', { name: 'contacts.platformPicker.add' }))

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument()
  })

  it('keeps Platform contact selection after a recoverable add failure', async () => {
    const user = userEvent.setup()
    renderDirectory(createContactsMockScenario(ContactsMockScenario.AddPlatformFailure))
    await screen.findByText('Ralph Edwards')
    await user.click(screen.getByRole('button', { name: 'contacts.directory.addContact' }))
    await user.click(screen.getByRole('menuitem', { name: 'contacts.directory.addFromPlatform' }))
    const dialog = screen.getByRole('dialog', { name: 'contacts.platformPicker.title' })
    const option = await within(dialog).findByRole('checkbox', { name: /Ada Lovelace/ })
    await user.click(option)
    await user.click(within(dialog).getByRole('button', { name: 'contacts.platformPicker.add' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'contacts.platformPicker.addFailed',
    )
    expect(option).toBeChecked()
    expect(screen.getAllByText('Ada Lovelace')).toHaveLength(1)
  })

  it('shows a retryable available Platform contact query failure', async () => {
    const user = userEvent.setup()
    renderDirectory(createContactsMockScenario(ContactsMockScenario.PlatformContactsFailure))
    await screen.findByText('Ralph Edwards')
    await user.click(screen.getByRole('button', { name: 'contacts.directory.addContact' }))
    await user.click(screen.getByRole('menuitem', { name: 'contacts.directory.addFromPlatform' }))
    const dialog = screen.getByRole('dialog', { name: 'contacts.platformPicker.title' })

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'contacts.platformPicker.error',
    )
    expect(
      within(dialog).getByRole('button', { name: 'contacts.action.retry' }),
    ).toBeInTheDocument()
  })

  it('disables workspace selection and removes only selected Platform and External contacts', async () => {
    const user = userEvent.setup()
    renderDirectory(createContactsMockScenario(ContactsMockScenario.EeMixed))
    await screen.findByText('Ralph Edwards')

    const workspace = screen.getByRole('checkbox', { name: /Ralph Edwards/ })
    const platform = screen.getByRole('checkbox', { name: /Leslie Alexander/ })
    const external = screen.getByRole('checkbox', { name: /Courtney Henry/ })
    expect(workspace).toHaveAttribute('aria-disabled', 'true')
    expect(platform).not.toHaveAttribute('aria-disabled', 'true')
    expect(external).not.toHaveAttribute('aria-disabled', 'true')

    await user.click(screen.getByRole('checkbox', { name: 'contacts.directory.selectAll' }))
    expect(workspace).not.toBeChecked()
    expect(platform).toBeChecked()
    expect(external).toBeChecked()
    expect(screen.getByText('contacts.directory.selected')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'contacts.directory.removeSelected' }))
    await waitFor(() => expect(screen.queryByText('Leslie Alexander')).not.toBeInTheDocument())
    expect(screen.queryByText('Courtney Henry')).not.toBeInTheDocument()
    expect(screen.getByText('Ralph Edwards')).toBeInTheDocument()
  })

  it('keeps selected contacts after a recoverable removal failure', async () => {
    const user = userEvent.setup()
    renderDirectory(createContactsMockScenario(ContactsMockScenario.ContactRemovalFailure))
    await screen.findByText('Courtney Henry')

    const external = screen.getByRole('checkbox', { name: /Courtney Henry/ })
    await user.click(external)
    await user.click(screen.getByRole('button', { name: 'contacts.directory.removeSelected' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('contacts.directory.removalFailed')
    expect(external).toBeChecked()
    expect(screen.getByText('Courtney Henry')).toBeInTheDocument()
  })

  it('does not render contact data without view permission', () => {
    renderDirectory(createContactsMockScenario(ContactsMockScenario.NoAccess))

    expect(screen.getByText('contacts.directory.noAccessTitle')).toBeInTheDocument()
    expect(screen.queryByText('Ralph Edwards')).not.toBeInTheDocument()
  })

  it('distinguishes an empty directory, a read-only role, and an initial failure', async () => {
    const { unmount } = renderDirectory(createContactsMockScenario(ContactsMockScenario.Empty))
    expect(await screen.findByText('contacts.directory.externalEmptyTitle')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'contacts.directory.addExternal' }),
    ).toBeInTheDocument()
    unmount()

    const readOnly = renderDirectory(createContactsMockScenario(ContactsMockScenario.ReadOnly))
    expect(await screen.findByText('Ralph Edwards')).toBeInTheDocument()
    expect(screen.getByText('contacts.directory.viewOnly')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
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
