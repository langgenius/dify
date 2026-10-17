import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { render as renderWithConsoleState } from '@/test/console/render'
import { CreatorFilter } from '../creator-filter'

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const { mockConsoleOperationHooks } = await import('@/test/console/operation-hooks')
  return mockConsoleOperationHooks(await importOriginal(), {
    'workspaces.current.members.get': () => ({
      data: {
        accounts: [
          { id: 'member-1', name: 'Zoe', avatar_url: null, status: 'active' },
          { id: 'member-2', name: 'Alice', avatar_url: null, status: 'active' },
          { id: 'member-3', name: 'Bob', avatar_url: null, status: 'active' },
        ],
      },
      isError: false,
      isPending: false,
      refetch: vi.fn(),
    }),
  })
})

const render = (ui: Parameters<typeof renderWithConsoleState>[0]) =>
  renderWithConsoleState(ui, {
    wrapper: createConsoleQueryWrapper({ accountProfile: { id: 'member-2' } }).wrapper,
  })

describe('CreatorFilter', () => {
  it('filters creators through the shared search input and clears without taking focus', async () => {
    const user = userEvent.setup()
    render(<CreatorFilter value={[]} onChange={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'dataset.creatorFilter.creators' }))
    const searchInput = await screen.findByRole('searchbox', {
      name: 'app.studio.filters.searchCreators',
    })
    await user.type(searchInput, 'zo')

    expect(screen.getByRole('checkbox', { name: /Zoe/ })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /Bob/ })).not.toBeInTheDocument()

    const clearButton = screen.getByRole('button', { name: 'common.operation.clear' })
    expect(clearButton).toHaveAttribute('tabindex', '-1')
    await user.click(clearButton)

    expect(searchInput).toHaveValue('')
    expect(searchInput).toHaveFocus()
    expect(screen.getByRole('checkbox', { name: /Bob/ })).toBeInTheDocument()
  })
})
