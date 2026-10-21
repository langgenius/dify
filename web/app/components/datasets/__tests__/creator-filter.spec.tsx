import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { render as renderWithConsoleState } from '@/test/console/render'
import { CreatorFilter } from '../creator-filter'
import { CREATOR_FILTER_MAX_SELECTION } from '../creator-filter-query'

const members = vi.hoisted(() => ({
  result: {} as {
    data?: { accounts: { id: string; name: string; avatar_url: null; status: string }[] }
    isError: boolean
    isPending: boolean
    refetch: () => void
  },
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const { mockConsoleOperationHooks } = await import('@/test/console/operation-hooks')
  return mockConsoleOperationHooks(await importOriginal(), {
    'workspaces.current.members.get': () => members.result,
  })
})

const activeMembers = [
  { id: 'member-1', name: 'Zoe', avatar_url: null, status: 'active' },
  { id: 'member-2', name: 'Alice', avatar_url: null, status: 'active' },
  { id: 'member-3', name: 'Bob', avatar_url: null, status: 'active' },
  { id: 'member-4', name: 'Pending Pat', avatar_url: null, status: 'pending' },
]

const render = (ui: Parameters<typeof renderWithConsoleState>[0]) =>
  renderWithConsoleState(ui, {
    wrapper: createConsoleQueryWrapper({ accountProfile: { id: 'member-2' } }).wrapper,
  })

function ControlledCreatorFilter({
  initialValue = [],
  onChange,
}: {
  initialValue?: string[]
  onChange?: (value: string[]) => void
}) {
  const [value, setValue] = useState(initialValue)
  return (
    <CreatorFilter
      value={value}
      onChange={(nextValue) => {
        onChange?.(nextValue)
        setValue(nextValue)
      }}
    />
  )
}

describe('CreatorFilter', () => {
  beforeEach(() => {
    members.result = {
      data: { accounts: activeMembers },
      isError: false,
      isPending: false,
      refetch: vi.fn(),
    }
  })

  it('searches and selects creators with the keyboard, keeping selections hidden by the search', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ControlledCreatorFilter onChange={onChange} />)

    await user.click(screen.getByRole('combobox', { name: 'dataset.creatorFilter.creators' }))
    const options = await screen.findAllByRole('option')
    // The current user comes first and pending members are excluded.
    expect(options).toHaveLength(3)
    expect(options[0]).toHaveAccessibleName('Alice app.studio.filters.you')
    expect(options[1]).toHaveAccessibleName('Bob')
    expect(options[2]).toHaveAccessibleName('Zoe')

    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    expect(onChange).toHaveBeenLastCalledWith(['member-3'])
    expect(screen.getByRole('option', { name: 'Bob' })).toHaveAttribute('aria-selected', 'true')

    const searchInput = screen.getByRole('combobox', { name: 'app.studio.filters.searchCreators' })
    await user.type(searchInput, 'zo')
    expect(screen.queryByRole('option', { name: 'Bob' })).not.toBeInTheDocument()
    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenLastCalledWith(['member-3', 'member-1'])

    await user.type(searchInput, 'nobody')
    expect(screen.getByText(/common.operation.noSearchResults/)).toBeInTheDocument()

    await user.keyboard('{Escape}')
    const trigger = screen.getByRole('combobox', { name: 'dataset.creatorFilter.creators: 2' })
    expect(trigger).toHaveFocus()

    await user.click(trigger)
    expect(screen.getByRole('combobox', { name: 'app.studio.filters.searchCreators' })).toHaveValue(
      '',
    )
    expect(screen.getAllByRole('option')).toHaveLength(3)
  })

  it('blocks new creators at the selection limit while selected creators can still be removed', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const unknownSelections = Array.from(
      { length: CREATOR_FILTER_MAX_SELECTION - 1 },
      (_, index) => `removed-member-${index}`,
    )
    render(
      <ControlledCreatorFilter
        initialValue={['member-1', ...unknownSelections]}
        onChange={onChange}
      />,
    )

    await user.click(
      screen.getByRole('combobox', {
        name: `dataset.creatorFilter.creators: ${CREATOR_FILTER_MAX_SELECTION}`,
      }),
    )

    const bob = await screen.findByRole('option', { name: 'Bob' })
    expect(bob).toHaveAttribute('aria-disabled', 'true')
    expect(bob).toHaveAccessibleDescription(/dataset.creatorFilter.maxCreators/)
    await user.click(bob)
    expect(onChange).not.toHaveBeenCalled()

    await user.click(screen.getByRole('option', { name: 'Zoe' }))
    expect(onChange).toHaveBeenLastCalledWith(unknownSelections)
    expect(screen.getByRole('option', { name: 'Bob' })).not.toHaveAttribute('aria-disabled')
  })

  it('clears the selection from outside the popup and keeps focus on the filter', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ControlledCreatorFilter initialValue={['member-1']} onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: 'app.studio.filters.reset' }))

    expect(onChange).toHaveBeenLastCalledWith([])
    expect(screen.getByRole('combobox', { name: 'dataset.creatorFilter.creators' })).toHaveFocus()
    expect(
      screen.queryByRole('button', { name: 'app.studio.filters.reset' }),
    ).not.toBeInTheDocument()
  })

  it('offers a retry for initial and cached refresh failures', async () => {
    const user = userEvent.setup()
    const refetch = vi.fn()
    members.result = { data: undefined, isError: true, isPending: false, refetch }
    const { rerender } = render(<ControlledCreatorFilter />)

    await user.click(screen.getByRole('combobox', { name: 'dataset.creatorFilter.creators' }))
    const initialError = await screen.findByRole('alert')
    expect(
      screen.getByRole('combobox', { name: 'app.studio.filters.searchCreators' }),
    ).toBeDisabled()
    await user.click(within(initialError).getByRole('button', { name: 'common.operation.retry' }))
    expect(refetch).toHaveBeenCalledTimes(1)

    members.result = { data: { accounts: activeMembers }, isError: true, isPending: false, refetch }
    rerender(<ControlledCreatorFilter />)

    const refreshError = await screen.findByRole('alert')
    expect(screen.getAllByRole('option')).toHaveLength(3)
    await user.click(within(refreshError).getByRole('button', { name: 'common.operation.retry' }))
    expect(refetch).toHaveBeenCalledTimes(2)
  })
})
