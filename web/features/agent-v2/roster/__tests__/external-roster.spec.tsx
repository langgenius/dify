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

  it('resets a canceled connection draft and keeps verification unavailable', async () => {
    const user = userEvent.setup()
    renderRoster()
    const connect = screen.getByRole('button', { name: 'agentRoster.external.connect' })
    await user.click(connect)

    const dialog = await screen.findByRole('dialog', { name: 'agentRoster.external.connect' })
    await user.type(
      within(dialog).getByRole('textbox', { name: 'agentRoster.external.connection.endpoint' }),
      'https://agents.example.com',
    )
    await user.click(
      within(dialog).getByRole('combobox', {
        name: 'agentRoster.external.connection.authentication',
      }),
    )
    await user.click(
      await screen.findByRole('option', { name: 'agentRoster.external.connection.bearerToken' }),
    )
    await user.type(
      within(dialog).getByLabelText('agentRoster.external.connection.token'),
      'test-token',
    )
    expect(
      within(dialog).getByRole('button', { name: 'agentRoster.external.connection.verify' }),
    ).toBeDisabled()

    await user.click(within(dialog).getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(connect)

    const reopened = await screen.findByRole('dialog', { name: 'agentRoster.external.connect' })
    expect(
      within(reopened).getByRole('textbox', { name: 'agentRoster.external.connection.endpoint' }),
    ).toHaveValue('')
    expect(
      within(reopened).getByRole('combobox', {
        name: 'agentRoster.external.connection.authentication',
      }),
    ).toHaveTextContent('agentRoster.external.connection.none')
    expect(
      within(reopened).queryByLabelText('agentRoster.external.connection.token'),
    ).not.toBeInTheDocument()
    expect(
      within(reopened).getByRole('button', { name: 'agentRoster.external.connection.verify' }),
    ).toBeDisabled()
  })

  it('keeps connection management unavailable to workspace editors', () => {
    renderRoster({ role: 'editor' })

    expect(
      screen.queryByRole('button', { name: 'agentRoster.external.connect' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Contract Review Agent' })).toBeInTheDocument()
  })
})
