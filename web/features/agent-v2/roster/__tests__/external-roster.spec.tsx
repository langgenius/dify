import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { renderWithNuqs } from '@/test/nuqs-testing'
import { ExternalRoster } from '../external-roster'

function renderRoster({
  role = 'owner',
  searchParams = '',
}: {
  role?: 'owner' | 'editor'
  searchParams?: string
} = {}) {
  const { wrapper: ConsoleQueryProvider } = createConsoleQueryWrapper({
    currentWorkspace: { role },
  })
  return renderWithNuqs(
    <ConsoleQueryProvider>
      <ExternalRoster />
    </ConsoleQueryProvider>,
    { hasMemory: true, searchParams },
  )
}

async function openActions(user: ReturnType<typeof userEvent.setup>, name: string) {
  const card = screen.getByRole('listitem', { name })
  await user.click(within(card).getByRole('button', { name: /agentRoster\.roster\.moreActions/ }))
}

describe('ExternalRoster', () => {
  it('combines status, connected-by-me and search filters with a recoverable empty state', async () => {
    const user = userEvent.setup()
    const { onUrlUpdate } = renderRoster()

    await user.click(
      screen.getByRole('radio', { name: /agentRoster\.external\.filters\.disabled/ }),
    )
    expect(screen.getByRole('heading', { name: 'Vendor Screening Agent' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Contract Review Agent' })).not.toBeInTheDocument()

    const connectedByMe = screen.getByRole('checkbox', {
      name: 'agentRoster.external.filters.connectedByMe',
    })
    await user.click(connectedByMe)
    expect(screen.getByRole('status')).toHaveTextContent('agentRoster.external.emptySearch')

    await user.click(screen.getByRole('radio', { name: 'agentRoster.roster.filters.all' }))
    expect(screen.getByRole('heading', { name: 'Contract Review Agent' })).toBeInTheDocument()

    const search = screen.getByRole('searchbox', { name: 'agentRoster.roster.searchLabel' })
    await user.type(search, 'vendor')
    expect(screen.getByRole('status')).toHaveTextContent('agentRoster.external.emptySearch')
    await user.click(connectedByMe)
    expect(screen.getByRole('heading', { name: 'Vendor Screening Agent' })).toBeInTheDocument()

    await waitFor(() => {
      const params = onUrlUpdate.mock.lastCall?.[0].searchParams
      expect(params?.get('external_keyword')).toBe('vendor')
      expect(params?.has('external_status')).toBe(false)
      expect(params?.has('external_connected_by_me')).toBe(false)
    })
    await user.clear(search)
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(2)
  })

  it('sorts the local list using the URL selection without replacing other filters', async () => {
    const user = userEvent.setup()
    const { onUrlUpdate } = renderRoster({ searchParams: '?external_keyword=agent&filter=drafts' })
    const names = () =>
      within(screen.getByRole('list', { name: 'agentRoster.roster.listLabel' }))
        .getAllByRole('heading', { level: 2 })
        .map((heading) => heading.textContent)
    expect(names()).toEqual(['Vendor Screening Agent', 'Contract Review Agent'])

    await user.click(screen.getByRole('combobox', { name: 'agentRoster.roster.sort.label' }))
    await user.click(
      await screen.findByRole('option', { name: 'agentRoster.roster.sort.recentlyCreated' }),
    )

    expect(names()).toEqual(['Contract Review Agent', 'Vendor Screening Agent'])
    await waitFor(() => {
      const params = onUrlUpdate.mock.lastCall?.[0].searchParams
      expect(params?.get('external_sort_by')).toBe('recently_created')
      expect(params?.get('external_keyword')).toBe('agent')
      expect(params?.get('filter')).toBe('drafts')
    })
  })

  it('keeps detail links available without exposing connection management to workspace editors', () => {
    renderRoster({ role: 'editor' })

    expect(
      screen.queryByRole('button', { name: 'agentRoster.external.connect' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /agentRoster\.roster\.moreActions/ }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Contract Review Agent' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Contract Review Agent' })).toHaveAttribute(
      'href',
      '/external-agent/contract-review/overview',
    )
    expect(screen.getByRole('link', { name: 'Vendor Screening Agent' })).toHaveAttribute(
      'href',
      '/external-agent/vendor-screening/overview',
    )
  })

  it('discards canceled edits and updates the card only after saving the reopened draft', async () => {
    const user = userEvent.setup()
    renderRoster()
    await openActions(user, 'Contract Review Agent')
    await user.click(await screen.findByRole('menuitem', { name: 'agentRoster.external.editInfo' }))

    const dialog = await screen.findByRole('dialog', { name: 'agentRoster.external.editInfo' })
    const name = within(dialog).getByRole('textbox', {
      name: 'agentRoster.roster.createForm.nameLabel',
    })
    await user.clear(name)
    await user.type(name, 'Unsaved name')
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('heading', { name: 'Contract Review Agent' })).toBeInTheDocument()

    await openActions(user, 'Contract Review Agent')
    await user.click(await screen.findByRole('menuitem', { name: 'agentRoster.external.editInfo' }))
    const reopened = await screen.findByRole('dialog', { name: 'agentRoster.external.editInfo' })
    const reopenedName = within(reopened).getByRole('textbox', {
      name: 'agentRoster.roster.createForm.nameLabel',
    })
    expect(reopenedName).toHaveValue('Contract Review Agent')
    await user.clear(reopenedName)
    await user.type(reopenedName, ' Contract Analyzer ')
    const role = within(reopened).getByRole('textbox', {
      name: /agentRoster\.roster\.createForm\.roleLabel/,
    })
    await user.clear(role)
    await user.type(role, ' Legal operations ')
    const description = within(reopened).getByRole('textbox', {
      name: 'agentRoster.roster.createForm.descriptionLabel',
    })
    await user.clear(description)
    await user.type(description, ' Reviews purchase agreements. ')
    await user.click(within(reopened).getByRole('button', { name: 'common.operation.save' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const updated = screen.getByRole('listitem', { name: 'Contract Analyzer' })
    expect(within(updated).getByText('Legal operations')).toBeInTheDocument()
    expect(within(updated).getByText('Reviews purchase agreements.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Contract Review Agent' })).not.toBeInTheDocument()
  })

  it('changes status counts and filtered results only after enabling or disabling is confirmed', async () => {
    const user = userEvent.setup()
    renderRoster({ searchParams: '?external_status=disabled' })
    await openActions(user, 'Vendor Screening Agent')
    expect(
      screen.queryByRole('menuitem', { name: 'agentRoster.external.disable' }),
    ).not.toBeInTheDocument()
    await user.click(await screen.findByRole('menuitem', { name: 'agentRoster.external.enable' }))

    const enableDialog = await screen.findByRole('alertdialog', {
      name: 'agentRoster.external.enableDialog.title',
    })
    await user.click(within(enableDialog).getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(
      screen.getByRole('radio', { name: 'agentRoster.external.filters.enabled 1' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Vendor Screening Agent' })).toBeInTheDocument()

    await openActions(user, 'Vendor Screening Agent')
    await user.click(await screen.findByRole('menuitem', { name: 'agentRoster.external.enable' }))
    const confirmedEnable = await screen.findByRole('alertdialog', {
      name: 'agentRoster.external.enableDialog.title',
    })
    await user.click(
      within(confirmedEnable).getByRole('button', { name: 'agentRoster.external.enable' }),
    )
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(screen.getByRole('status')).toHaveTextContent('agentRoster.external.emptySearch')
    expect(
      screen.getByRole('radio', { name: 'agentRoster.external.filters.disabled 0' }),
    ).toBeChecked()
    await user.click(screen.getByRole('radio', { name: 'agentRoster.external.filters.enabled 2' }))

    await openActions(user, 'Vendor Screening Agent')
    expect(
      screen.queryByRole('menuitem', { name: 'agentRoster.external.enable' }),
    ).not.toBeInTheDocument()
    await user.click(await screen.findByRole('menuitem', { name: 'agentRoster.external.disable' }))
    const disableDialog = await screen.findByRole('alertdialog', {
      name: 'agentRoster.external.disableDialog.title',
    })
    await user.click(
      within(disableDialog).getByRole('button', { name: 'agentRoster.external.disable' }),
    )
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())

    expect(
      screen.queryByRole('heading', { name: 'Vendor Screening Agent' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Contract Review Agent' })).toBeInTheDocument()
    expect(
      screen.getByRole('radio', { name: 'agentRoster.external.filters.enabled 1' }),
    ).toBeChecked()
    expect(
      screen.getByRole('radio', { name: 'agentRoster.external.filters.disabled 1' }),
    ).toBeInTheDocument()
  })

  it('keeps canceled deletions and restores usable focus after deleting a card and the last card', async () => {
    const user = userEvent.setup()
    renderRoster()
    await openActions(user, 'Vendor Screening Agent')
    await user.click(await screen.findByRole('menuitem', { name: 'agentRoster.external.delete' }))

    const canceled = await screen.findByRole('alertdialog', {
      name: 'agentRoster.external.deleteDialog.title',
    })
    await user.click(within(canceled).getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(screen.getByRole('heading', { name: 'Vendor Screening Agent' })).toBeInTheDocument()

    await openActions(user, 'Vendor Screening Agent')
    await user.click(await screen.findByRole('menuitem', { name: 'agentRoster.external.delete' }))
    const confirmed = await screen.findByRole('alertdialog', {
      name: 'agentRoster.external.deleteDialog.title',
    })
    await user.click(within(confirmed).getByRole('button', { name: 'agentRoster.external.delete' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(
      screen.queryByRole('heading', { name: 'Vendor Screening Agent' }),
    ).not.toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Contract Review Agent' })).toHaveFocus(),
    )

    await openActions(user, 'Contract Review Agent')
    await user.click(await screen.findByRole('menuitem', { name: 'agentRoster.external.delete' }))
    const lastCard = await screen.findByRole('alertdialog', {
      name: 'agentRoster.external.deleteDialog.title',
    })
    await user.click(within(lastCard).getByRole('button', { name: 'agentRoster.external.delete' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())

    expect(screen.getByRole('status')).toHaveTextContent('agentRoster.external.empty')
    await waitFor(() =>
      expect(
        screen.getByRole('searchbox', { name: 'agentRoster.roster.searchLabel' }),
      ).toHaveFocus(),
    )
  })
})
