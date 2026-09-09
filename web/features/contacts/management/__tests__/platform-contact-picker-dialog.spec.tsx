import type { ContactsManagementRepository } from '../repository'
import type { ContactsFeatureContextValue } from '../types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/client'
import { ContactsManagementMockProvider, ContactsManagementProvider } from '../composition'
import { createContactsMockRepository } from '../mock/repository'
import { ContactsMockScenario, createContactsMockScenario } from '../mock/scenarios'
import { PlatformContactPickerDialog } from '../platform-contact-picker-dialog'

describe('PlatformContactPickerDialog', () => {
  it('asks before upgrading an External Contact and keeps the selection after cancellation', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    })
    const onOpenChange = vi.fn()
    render(
      <QueryClientProvider client={queryClient}>
        <ContactsManagementMockProvider
          scenario={createContactsMockScenario(ContactsMockScenario.EeMixed)}
        >
          <PlatformContactPickerDialog open onOpenChange={onOpenChange} />
        </ContactsManagementMockProvider>
      </QueryClientProvider>,
    )

    const user = userEvent.setup()
    const picker = screen.getByRole('dialog', { name: 'contacts.platformPicker.title' })
    const option = await within(picker).findByRole('checkbox', { name: /Courtney Henry/ })
    await user.click(option)
    await user.click(within(picker).getByRole('button', { name: 'contacts.platformPicker.add' }))

    const confirmation = await screen.findByRole('alertdialog', {
      name: /contacts\.platformPicker\.upgrade\.title/i,
    })
    expect(onOpenChange).not.toHaveBeenCalled()
    await user.click(within(confirmation).getByRole('button', { name: 'contacts.action.cancel' }))

    await waitFor(() => {
      expect(
        screen.queryByRole('alertdialog', {
          name: /contacts\.platformPicker\.upgrade\.title/i,
        }),
      ).not.toBeInTheDocument()
    })
    expect(option).toBeChecked()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('adds and upgrades the selected External Contact after confirmation', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    })
    const onOpenChange = vi.fn()
    render(
      <QueryClientProvider client={queryClient}>
        <ContactsManagementMockProvider
          scenario={createContactsMockScenario(ContactsMockScenario.EeMixed)}
        >
          <PlatformContactPickerDialog open onOpenChange={onOpenChange} />
        </ContactsManagementMockProvider>
      </QueryClientProvider>,
    )

    const user = userEvent.setup()
    const picker = screen.getByRole('dialog', { name: 'contacts.platformPicker.title' })
    await user.click(await within(picker).findByRole('checkbox', { name: /Courtney Henry/ }))
    await user.click(within(picker).getByRole('button', { name: 'contacts.platformPicker.add' }))

    const confirmation = await screen.findByRole('alertdialog', {
      name: /contacts\.platformPicker\.upgrade\.title/i,
    })
    await user.click(
      within(confirmation).getByRole('button', {
        name: 'contacts.platformPicker.upgrade.confirm',
      }),
    )

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('keeps selection visible and prevents duplicate add while pending', async () => {
    const waits: Array<() => void> = []
    const wait = () =>
      new Promise<void>((resolve) => {
        waits.push(resolve)
      })
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    })
    const onOpenChange = vi.fn()
    render(
      <QueryClientProvider client={queryClient}>
        <ContactsManagementMockProvider
          scenario={createContactsMockScenario(ContactsMockScenario.EeMixed)}
          wait={wait}
        >
          <PlatformContactPickerDialog open onOpenChange={onOpenChange} />
        </ContactsManagementMockProvider>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(waits).toHaveLength(1))
    await act(async () => waits.shift()?.())
    const user = userEvent.setup()
    const dialog = screen.getByRole('dialog', { name: 'contacts.platformPicker.title' })
    const option = await within(dialog).findByRole('checkbox', { name: /Ada Lovelace/ })
    await user.click(option)
    await user.click(within(dialog).getByRole('button', { name: 'contacts.platformPicker.add' }))
    await waitFor(() => expect(waits).toHaveLength(1))

    expect(option).toBeChecked()
    expect(
      within(dialog).getByRole('button', { name: 'contacts.platformPicker.adding' }),
    ).toHaveAttribute('aria-disabled', 'true')
    expect(onOpenChange).not.toHaveBeenCalled()
    await act(async () => waits.shift()?.())
    await waitFor(() => expect(waits).toHaveLength(1))
    await act(async () => waits.shift()?.())
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })
})

describe('Enterprise Platform contact import', () => {
  const candidate = {
    id: 'candidate-1',
    name: 'Platform Member',
    email: 'member@example.test',
    avatar_url: null,
  }
  function setup(overrides: Partial<ContactsFeatureContextValue> = {}) {
    const scenario = createContactsMockScenario(ContactsMockScenario.EeMixed)
    const context = {
      workspaceId: scenario.workspaceId,
      deployment: scenario.deployment,
      permissions: scenario.permissions,
      ...overrides,
    }
    const listAvailablePlatformContacts = vi
      .fn<ContactsManagementRepository['listAvailablePlatformContacts']>()
      .mockResolvedValue({
        data: [candidate],
        page: 1,
        limit: 20,
        total: 1,
        has_more: false,
      })
    const addPlatformContacts = vi
      .fn<ContactsManagementRepository['addPlatformContacts']>()
      .mockResolvedValue({ kind: 'added', contactIds: [candidate.id] })
    const repository = {
      ...createContactsMockRepository({ scenario }),
      supportsPlatformImport: true,
      supportsExternalContactUpgrade: false,
      listAvailablePlatformContacts,
      addPlatformContacts,
    }
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    })
    const onOpenChange = vi.fn()
    const renderPicker = () =>
      render(
        <QueryClientProvider client={queryClient}>
          <ContactsManagementProvider context={context} repository={repository}>
            <PlatformContactPickerDialog open onOpenChange={onOpenChange} />
          </ContactsManagementProvider>
        </QueryClientProvider>,
      )
    return {
      context,
      listAvailablePlatformContacts,
      addPlatformContacts,
      queryClient,
      onOpenChange,
      renderPicker,
    }
  }

  it('can move past a fully excluded page, retry the next page, and search the server without invented departments', async () => {
    const { listAvailablePlatformContacts, renderPicker } = setup()
    listAvailablePlatformContacts
      .mockResolvedValueOnce({ data: [], page: 1, limit: 20, total: 21, has_more: true })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ data: [candidate], page: 2, limit: 20, total: 21, has_more: false })
    renderPicker()
    const user = userEvent.setup()
    const picker = screen.getByRole('dialog', { name: 'contacts.platformPicker.title' })
    expect(within(picker).queryByText('contacts.platformPicker.devTeam')).not.toBeInTheDocument()
    await user.click(
      await within(picker).findByRole('button', { name: 'contacts.action.loadMore' }),
    )
    expect(await within(picker).findByRole('alert')).toHaveTextContent(
      'contacts.platformPicker.error',
    )
    await user.click(within(picker).getByRole('button', { name: 'contacts.action.retry' }))
    await within(picker).findByRole('checkbox', { name: /Platform Member/ })
    expect(listAvailablePlatformContacts.mock.calls.map(([query]) => query.page)).toEqual([1, 2, 2])
    await user.type(
      within(picker).getByRole('searchbox', { name: 'contacts.platformPicker.search' }),
      'Member',
    )
    await waitFor(() =>
      expect(listAvailablePlatformContacts).toHaveBeenLastCalledWith({
        search: 'Member',
        page: 1,
        limit: 20,
      }),
    )
  })

  it('imports selected candidates and invalidates contacts, workflow options, and platform candidates after success', async () => {
    const { context, addPlatformContacts, queryClient, onOpenChange, renderPicker } = setup()
    const keys = [
      ['contacts-management', context.workspaceId, 'directory'],
      consoleQuery.workspaces.current.humanInput.contacts.key(),
      consoleQuery.workspaces.current.humanInput.contactOptions.key(),
      consoleQuery.workspaces.current.humanInput.organizationCandidates.key(),
    ]
    keys.forEach((key) => queryClient.setQueryData(key, { data: [] }))
    renderPicker()
    const user = userEvent.setup()
    const picker = screen.getByRole('dialog', { name: 'contacts.platformPicker.title' })
    expect(
      within(picker).getByText('contacts.platformPicker.noExternalUpgrade'),
    ).toBeInTheDocument()
    await user.click(await within(picker).findByRole('checkbox', { name: /Platform Member/ }))
    await user.click(within(picker).getByRole('button', { name: 'contacts.platformPicker.add' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(addPlatformContacts).toHaveBeenCalledWith({
      contactIds: [candidate.id],
      upgradeExternalContacts: false,
    })
    keys.forEach((key) => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it.each([
    ['conflict', 'platformPicker.addConflict'],
    ['forbidden', 'platformPicker.addForbidden'],
    ['external_upgrade_unsupported', 'platformPicker.externalUpgradeUnsupported'],
    ['failed', 'platformPicker.addFailed'],
  ] as const)(
    'keeps selection and the picker open after %s without offering a fake upgrade',
    async (kind, errorKey) => {
      const { addPlatformContacts, onOpenChange, renderPicker } = setup()
      addPlatformContacts.mockResolvedValue({ kind })
      renderPicker()
      const user = userEvent.setup()
      const picker = screen.getByRole('dialog', { name: 'contacts.platformPicker.title' })
      const option = await within(picker).findByRole('checkbox', { name: /Platform Member/ })
      await user.click(option)
      await user.click(within(picker).getByRole('button', { name: 'contacts.platformPicker.add' }))
      expect(await within(picker).findByRole('alert')).toHaveTextContent(`contacts.${errorKey}`)
      expect(option).toBeChecked()
      expect(onOpenChange).not.toHaveBeenCalled()
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    },
  )

  it.each<Partial<ContactsFeatureContextValue>>([
    { deployment: 'ce' },
    { deployment: 'saas' },
    { workspaceId: '' },
    { permissions: { canViewContacts: true, canManageContacts: false, canManageMembers: false } },
  ])(
    'does not query or expose selectable candidates without authorized Enterprise context',
    async (overrides) => {
      const { listAvailablePlatformContacts, addPlatformContacts, renderPicker } = setup(overrides)
      renderPicker()
      const picker = screen.getByRole('dialog', { name: 'contacts.platformPicker.title' })
      expect(within(picker).getByRole('alert')).toHaveTextContent(
        'contacts.platformPicker.addForbidden',
      )
      expect(within(picker).queryByRole('checkbox')).not.toBeInTheDocument()
      expect(listAvailablePlatformContacts).not.toHaveBeenCalled()
      expect(addPlatformContacts).not.toHaveBeenCalled()
    },
  )
})
