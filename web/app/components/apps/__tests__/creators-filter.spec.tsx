import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { render as renderWithConsoleState } from '@/test/console/render'
import CreatorsFilter from '../creators-filter'

const mockOnChange = vi.hoisted(() => vi.fn())

const render = (ui: Parameters<typeof renderWithConsoleState>[0]) =>
  renderWithConsoleState(ui, {
    wrapper: createConsoleQueryWrapper({ accountProfile: { id: 'member-2' } }).wrapper,
  })

const StatefulCreatorsFilter = ({ initialValue }: { initialValue: string[] }) => {
  const [value, setValue] = useState(initialValue)
  return <CreatorsFilter value={value} onChange={setValue} />
}

vi.mock('@/service/use-common', () => ({
  useMembers: () => ({
    data: {
      accounts: [
        { id: 'member-1', name: 'Zoe', avatar_url: null, status: 'active' },
        { id: 'member-2', name: 'Alice', avatar_url: null, status: 'active' },
        { id: 'member-3', name: 'Bob', avatar_url: null, status: 'active' },
        { id: 'member-4', name: 'Pending User', avatar_url: null, status: 'pending' },
      ],
    },
  }),
}))

describe('CreatorsFilter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should sort the current user first and filter out pending members', () => {
    render(<CreatorsFilter value={[]} onChange={mockOnChange} />)

    fireEvent.click(screen.getByRole('button', { name: /app\.studio\.filters\.creators/i }))

    const options = screen.getAllByRole('checkbox')

    expect(options.map((option) => option.textContent)).toEqual([
      expect.stringContaining('Alice'),
      expect.stringContaining('Bob'),
      expect.stringContaining('Zoe'),
    ])
    expect(screen.getByText('app.studio.filters.you')).toBeInTheDocument()
    expect(screen.queryByText('Pending User')).not.toBeInTheDocument()
  })

  it('should search creators, clear keywords, and select a creator', () => {
    render(<CreatorsFilter value={[]} onChange={mockOnChange} />)

    fireEvent.click(screen.getByRole('button', { name: /app\.studio\.filters\.creators/i }))
    fireEvent.change(screen.getByPlaceholderText('app.studio.filters.searchCreators'), {
      target: { value: 'zo' },
    })

    expect(screen.getByRole('checkbox', { name: /Zoe/ })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /Bob/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.clear' }))

    const searchInput = screen.getByPlaceholderText('app.studio.filters.searchCreators')
    expect(searchInput).toHaveValue('')
    expect(searchInput).toHaveFocus()

    fireEvent.click(screen.getByRole('checkbox', { name: /Bob/ }))

    expect(mockOnChange).toHaveBeenCalledWith(['member-3'])
  })

  it('should return focus to the trigger after clearing creators from the filter chip', async () => {
    const user = userEvent.setup()
    render(<StatefulCreatorsFilter initialValue={['member-2', 'member-3']} />)

    const trigger = screen.getByRole('button', { name: /app\.studio\.filters\.creators/i })
    const triggerReset = screen.getByRole('button', { name: 'app.studio.filters.reset' })

    expect(trigger).not.toContainElement(triggerReset)

    await user.click(triggerReset)

    expect(trigger).toHaveFocus()
    expect(
      screen.queryByRole('button', { name: 'app.studio.filters.reset' }),
    ).not.toBeInTheDocument()
  })

  it('should return focus to the search input after clearing creators from the popover', async () => {
    const user = userEvent.setup()
    render(<StatefulCreatorsFilter initialValue={['member-2', 'member-3']} />)

    await user.click(screen.getByRole('button', { name: /app\.studio\.filters\.creators/i }))
    const searchInput = screen.getByRole('searchbox', {
      name: 'app.studio.filters.searchCreators',
    })
    const popover = screen.getByRole('dialog', { name: 'app.studio.filters.creators' })

    await user.click(within(popover).getByRole('button', { name: 'app.studio.filters.reset' }))

    expect(searchInput).toHaveFocus()
    expect(popover).not.toHaveTextContent('app.studio.filters.reset')
  })

  it('should remove a selected creator when toggled from the menu', () => {
    render(<CreatorsFilter value={['member-2', 'member-3']} onChange={mockOnChange} />)

    fireEvent.click(screen.getByRole('button', { name: /app\.studio\.filters\.creators/i }))
    const aliceCheckbox = screen.getByRole('checkbox', { name: /Alice/ })
    expect(aliceCheckbox).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(aliceCheckbox)

    expect(mockOnChange).toHaveBeenCalledWith(['member-3'])
  })

  it('should expose the creator picker as a named dialog with checkbox options', () => {
    render(<CreatorsFilter value={[]} onChange={mockOnChange} />)

    fireEvent.click(screen.getByRole('button', { name: /app\.studio\.filters\.creators/i }))

    expect(screen.getByRole('dialog', { name: 'app.studio.filters.creators' })).toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Alice/ })).toHaveAttribute('aria-checked', 'false')
  })
})
