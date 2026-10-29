import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { render as renderWithConsoleState } from '@/test/console/render'
import CreatorsFilter from '../creators-filter'

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.members.get': async () => ({
        accounts: [
          { id: 'member-1', name: 'Zoe', avatar_url: null, status: 'active' },
          { id: 'member-2', name: 'Alice', avatar_url: null, status: 'active' },
          { id: 'member-3', name: 'Bob', avatar_url: null, status: 'active' },
          { id: 'member-4', name: 'Pending User', avatar_url: null, status: 'pending' },
          { id: 'member-5', name: 'Charlie', avatar_url: null, status: 'active' },
          { id: 'member-6', name: 'Robin', avatar_url: null, status: 'active' },
        ],
      }),
    }),
  }
})

const mockOnChange = vi.hoisted(() => vi.fn())

const render = (ui: Parameters<typeof renderWithConsoleState>[0]) =>
  renderWithConsoleState(ui, {
    wrapper: createConsoleQueryWrapper({ accountProfile: { id: 'member-2' } }).wrapper,
  })

const StatefulCreatorsFilter = ({ initialValue }: { initialValue: string[] }) => {
  const [value, setValue] = useState(initialValue)
  return <CreatorsFilter value={value} onChange={setValue} />
}

describe('CreatorsFilter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should sort the current user first and filter out pending members', async () => {
    const user = userEvent.setup()
    render(<CreatorsFilter value={[]} onChange={mockOnChange} />)

    await user.click(screen.getByRole('combobox', { name: 'app.studio.filters.creators' }))

    await screen.findByRole('option', { name: /Alice/ })
    const options = screen.getAllByRole('option')

    expect(options.map((option) => option.textContent)).toEqual([
      expect.stringContaining('Alice'),
      expect.stringContaining('Bob'),
      expect.stringContaining('Charlie'),
      expect.stringContaining('Robin'),
      expect.stringContaining('Zoe'),
    ])
    expect(screen.getByText('app.studio.filters.you')).toBeInTheDocument()
    expect(screen.queryByText('Pending User')).not.toBeInTheDocument()
  })

  it('should search creators, clear the query, and select a creator', async () => {
    const user = userEvent.setup()
    render(<CreatorsFilter value={[]} onChange={mockOnChange} />)

    await user.click(screen.getByRole('combobox', { name: 'app.studio.filters.creators' }))
    const searchInput = screen.getByRole('combobox', {
      name: 'app.studio.filters.searchCreators',
    })
    await user.type(searchInput, 'zo')

    const zoeOption = await screen.findByRole('option', { name: /Zoe/ })
    expect(zoeOption).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Bob/ })).not.toBeInTheDocument()
    await waitFor(() => {
      expect(searchInput).toHaveAttribute('aria-activedescendant', zoeOption.id)
    })

    await user.clear(searchInput)

    expect(searchInput).toHaveValue('')
    expect(searchInput).toHaveFocus()

    await user.click(screen.getByRole('option', { name: /Bob/ }))

    expect(mockOnChange).toHaveBeenCalledWith(['member-3'])
  })

  it('should return focus to the trigger after clearing creators from the filter chip', async () => {
    const user = userEvent.setup()
    render(<StatefulCreatorsFilter initialValue={['member-2', 'member-3']} />)

    const trigger = screen.getByRole('combobox', { name: 'app.studio.filters.creators' })
    const triggerReset = screen.getByRole('button', { name: 'app.studio.filters.reset' })

    expect(trigger).not.toContainElement(triggerReset)

    await user.click(triggerReset)

    expect(trigger).toHaveFocus()
    expect(
      screen.queryByRole('button', { name: 'app.studio.filters.reset' }),
    ).not.toBeInTheDocument()
  })

  it('should preserve unavailable creator ids when removing an available creator', async () => {
    const user = userEvent.setup()
    render(
      <CreatorsFilter value={['missing-member', 'member-2', 'member-3']} onChange={mockOnChange} />,
    )

    await user.click(screen.getByRole('combobox', { name: 'app.studio.filters.creators' }))
    const aliceOption = await screen.findByRole('option', { name: /Alice/ })
    expect(aliceOption).toHaveAttribute('aria-selected', 'true')

    await user.click(aliceOption)

    expect(mockOnChange).toHaveBeenCalledWith(['missing-member', 'member-3'])
  })

  it.each([
    { value: ['member-2'], visibleInitials: ['A'], remainingCount: 0 },
    {
      value: ['member-2', 'member-3', 'member-1'],
      visibleInitials: ['A', 'B', 'Z'],
      remainingCount: 0,
    },
    {
      value: ['member-2', 'member-3', 'member-1', 'member-5'],
      visibleInitials: ['A', 'B', 'Z'],
      remainingCount: 1,
    },
    {
      value: ['member-2', 'member-3', 'member-1', 'member-5', 'member-6'],
      visibleInitials: ['A', 'B', 'Z'],
      remainingCount: 2,
    },
  ])(
    'shows only the $remainingCount undisplayed creators in the overflow count',
    async ({ value, visibleInitials, remainingCount }) => {
      render(<CreatorsFilter value={value} onChange={mockOnChange} />)

      const trigger = screen.getByRole('combobox', { name: 'app.studio.filters.creators' })
      for (const initial of visibleInitials) {
        expect(await within(trigger).findByText(initial, { exact: true })).toBeInTheDocument()
      }
      expect(
        within(trigger).getByText(`common.dynamicSelect.selected:{"count":${value.length}}`),
      ).toBeInTheDocument()
      expect(within(trigger).queryByText('C', { exact: true })).not.toBeInTheDocument()
      expect(within(trigger).queryByText('R', { exact: true })).not.toBeInTheDocument()
      if (remainingCount > 0) {
        expect(within(trigger).getByText(`+${remainingCount}`)).toBeInTheDocument()
      } else {
        expect(within(trigger).queryByText(/^\+\d+$/)).not.toBeInTheDocument()
      }
    },
  )

  it('should expose the creator picker as a named combobox with keyboard-owned options', async () => {
    const user = userEvent.setup()
    render(<CreatorsFilter value={[]} onChange={mockOnChange} />)

    await user.click(screen.getByRole('combobox', { name: 'app.studio.filters.creators' }))

    const popup = screen.getByRole('dialog', { name: 'app.studio.filters.creators' })
    const searchInput = within(popup).getByRole('combobox', {
      name: 'app.studio.filters.searchCreators',
    })
    expect(await within(popup).findByRole('option', { name: /Alice/ })).toHaveAttribute(
      'aria-selected',
      'false',
    )

    await waitFor(() => expect(searchInput).toHaveFocus())
    await user.keyboard('{ArrowDown}{Enter}')

    expect(mockOnChange).toHaveBeenCalledWith(['member-2'])
  })
})
