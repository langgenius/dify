import { screen, waitFor, within } from '@testing-library/react'
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

  it('should sort the current user first and filter out pending members', async () => {
    const user = userEvent.setup()
    render(<CreatorsFilter value={[]} onChange={mockOnChange} />)

    await user.click(screen.getByRole('combobox', { name: 'app.studio.filters.creators' }))

    const options = screen.getAllByRole('option')

    expect(options.map((option) => option.textContent)).toEqual([
      expect.stringContaining('Alice'),
      expect.stringContaining('Bob'),
      expect.stringContaining('Zoe'),
    ])
    expect(screen.getByText('app.studio.filters.you')).toBeInTheDocument()
    expect(screen.queryByText('Pending User')).not.toBeInTheDocument()
  })

  it('should search creators, clear keywords, and select a creator', async () => {
    const user = userEvent.setup()
    render(<CreatorsFilter value={[]} onChange={mockOnChange} />)

    await user.click(screen.getByRole('combobox', { name: 'app.studio.filters.creators' }))
    const searchInput = screen.getByRole('combobox', {
      name: 'app.studio.filters.searchCreators',
    })
    await user.type(searchInput, 'zo')

    const zoeOption = screen.getByRole('option', { name: /Zoe/ })
    expect(zoeOption).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Bob/ })).not.toBeInTheDocument()
    await waitFor(() => {
      expect(searchInput).toHaveAttribute('aria-activedescendant', zoeOption.id)
    })

    await user.click(screen.getByRole('button', { name: 'common.operation.clear' }))

    expect(searchInput).toHaveValue('')
    expect(searchInput).toHaveFocus()

    await user.click(screen.getByRole('option', { name: /Bob/ }))

    expect(mockOnChange).toHaveBeenCalledWith(['member-3'])
  })

  it('should clear only the search query from the input action', async () => {
    const user = userEvent.setup()
    render(<CreatorsFilter value={['member-2']} onChange={mockOnChange} />)

    await user.click(screen.getByRole('combobox', { name: 'app.studio.filters.creators' }))
    const searchInput = screen.getByRole('combobox', {
      name: 'app.studio.filters.searchCreators',
    })
    await user.type(searchInput, 'zo')
    await user.click(screen.getByRole('button', { name: 'common.operation.clear' }))

    expect(searchInput).toHaveValue('')
    expect(searchInput).toHaveFocus()
    expect(screen.getByRole('option', { name: /Alice/ })).toHaveAttribute('aria-selected', 'true')
    expect(mockOnChange).not.toHaveBeenCalled()
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
    const aliceOption = screen.getByRole('option', { name: /Alice/ })
    expect(aliceOption).toHaveAttribute('aria-selected', 'true')

    await user.click(aliceOption)

    expect(mockOnChange).toHaveBeenCalledWith(['missing-member', 'member-3'])
  })

  it('should expose the selected creator count from the closed trigger', () => {
    render(<CreatorsFilter value={['member-2', 'member-3']} onChange={mockOnChange} />)

    const trigger = screen.getByRole('combobox', { name: 'app.studio.filters.creators' })
    const selectedCount = within(trigger).getByText('common.dynamicSelect.selected:{"count":2}')
    expect(selectedCount).toHaveClass('sr-only')
    expect(within(trigger).getByText('+2').parentElement).toHaveAttribute('aria-hidden', 'true')
  })

  it('should expose the creator picker as a named combobox with keyboard-owned options', async () => {
    const user = userEvent.setup()
    render(<CreatorsFilter value={[]} onChange={mockOnChange} />)

    await user.click(screen.getByRole('combobox', { name: 'app.studio.filters.creators' }))

    const popup = screen.getByRole('dialog', { name: 'app.studio.filters.creators' })
    const searchInput = within(popup).getByRole('combobox', {
      name: 'app.studio.filters.searchCreators',
    })
    expect(popup).toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(within(popup).getByRole('option', { name: /Alice/ })).toHaveAttribute(
      'aria-selected',
      'false',
    )

    await waitFor(() => expect(searchInput).toHaveFocus())
    await user.keyboard('{ArrowDown}{Enter}')

    expect(mockOnChange).toHaveBeenCalledWith(['member-2'])
  })
})
