import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vite-plus/test'
import { useMembers } from '@/service/use-common'
import MemberSelector from '../member-selector'

vi.mock('@/service/use-common')

const mockAccounts = [
  { id: '1', name: 'John Doe', email: 'john@example.com', avatar_url: '' },
  { id: '2', name: 'Jane Smith', email: 'jane@example.com', avatar_url: '' },
  { id: '3', name: 'Bob Wilson', email: 'bob@example.com', avatar_url: '' },
]

const getTrigger = () =>
  screen.getByRole('button', {
    name: 'common.members.transferModal.transferPlaceholder',
  })

const getMemberButtons = () =>
  screen.getAllByRole('button', {
    name: /@example\.com/,
  })

describe('MemberSelector', () => {
  const mockOnSelect = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useMembers).mockReturnValue({
      data: { accounts: mockAccounts },
    } as unknown as ReturnType<typeof useMembers>)
  })

  it('should render placeholder when no value is selected', () => {
    render(<MemberSelector onSelect={mockOnSelect} />)
    expect(getTrigger()).toHaveAttribute('aria-expanded', 'false')
  })

  it('should render selected member info', () => {
    render(<MemberSelector value="1" onSelect={mockOnSelect} />)
    expect(
      screen.getByRole('button', {
        name: /John Doe.*john@example\.com/,
      }),
    ).toBeInTheDocument()
  })

  it('should open dropdown and show filtered list on click', async () => {
    const user = userEvent.setup()
    render(<MemberSelector onSelect={mockOnSelect} exclude={['1']} />)

    await user.click(getTrigger())

    const items = getMemberButtons()
    expect(items).toHaveLength(2) // Jane and Bob (John excluded)
    expect(screen.queryByText('John Doe')).not.toBeInTheDocument()
    expect(screen.getByText('Jane Smith')).toBeInTheDocument()
  })

  it('should filter list by search value', async () => {
    const user = userEvent.setup()
    render(<MemberSelector onSelect={mockOnSelect} />)

    await user.click(getTrigger())
    await user.type(screen.getByRole('searchbox', { name: 'common.operation.search' }), 'Jane')

    const items = getMemberButtons()
    expect(items).toHaveLength(1)
    expect(screen.getByText('Jane Smith')).toBeInTheDocument()
    expect(screen.queryByText('Bob Wilson')).not.toBeInTheDocument()
  })

  it('should call onSelect and close dropdown when an item is clicked', async () => {
    const user = userEvent.setup()
    render(<MemberSelector onSelect={mockOnSelect} />)

    await user.click(getTrigger())
    await user.click(screen.getByRole('button', { name: /Jane Smith.*jane@example\.com/ }))

    expect(mockOnSelect).toHaveBeenCalledWith('2')
    await waitFor(() => {
      expect(
        screen.queryByRole('searchbox', { name: 'common.operation.search' }),
      ).not.toBeInTheDocument()
    })
  })

  it('should filter list by email when name does not match', async () => {
    const user = userEvent.setup()
    render(<MemberSelector onSelect={mockOnSelect} />)

    await user.click(getTrigger())
    await user.type(screen.getByRole('searchbox', { name: 'common.operation.search' }), 'john@')

    const items = getMemberButtons()
    expect(items).toHaveLength(1)
    expect(screen.getByText('John Doe')).toBeInTheDocument()
    expect(screen.queryByText('Jane Smith')).not.toBeInTheDocument()
  })

  it('should show placeholder when value does not match any account', () => {
    render(<MemberSelector value="nonexistent-id" onSelect={mockOnSelect} />)

    expect(getTrigger()).toBeInTheDocument()
  })

  it('should handle missing data gracefully', () => {
    vi.mocked(useMembers).mockReturnValue({ data: undefined } as unknown as ReturnType<
      typeof useMembers
    >)
    render(<MemberSelector onSelect={mockOnSelect} />)
    expect(getTrigger()).toBeInTheDocument()
  })

  it('should filter by email when account name is empty', async () => {
    const user = userEvent.setup()
    vi.mocked(useMembers).mockReturnValue({
      data: {
        accounts: [
          ...mockAccounts,
          { id: '4', name: '', email: 'noname@example.com', avatar_url: '' },
        ],
      },
    } as unknown as ReturnType<typeof useMembers>)
    render(<MemberSelector onSelect={mockOnSelect} />)

    await user.click(getTrigger())
    await user.type(screen.getByRole('searchbox', { name: 'common.operation.search' }), 'noname@')

    const items = getMemberButtons()
    expect(items).toHaveLength(1)
  })

  it('should expose the expanded state while the dropdown is open', async () => {
    const user = userEvent.setup()
    render(<MemberSelector onSelect={mockOnSelect} />)

    const trigger = getTrigger()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await user.click(trigger)

    expect(trigger).toHaveAttribute('aria-expanded', 'true')
  })

  it('should not match account when neither name nor email contains search value', async () => {
    const user = userEvent.setup()
    render(<MemberSelector onSelect={mockOnSelect} />)

    await user.click(getTrigger())
    await user.type(
      screen.getByRole('searchbox', { name: 'common.operation.search' }),
      'xyz-no-match-xyz',
    )

    expect(screen.queryAllByRole('button', { name: /@example\.com/ })).toHaveLength(0)
  })

  it('should fall back to empty string for account with undefined email when searching', async () => {
    const user = userEvent.setup()
    vi.mocked(useMembers).mockReturnValue({
      data: {
        accounts: [
          { id: '1', name: 'John', email: undefined as unknown as string, avatar_url: '' },
        ],
      },
    } as unknown as ReturnType<typeof useMembers>)
    render(<MemberSelector onSelect={mockOnSelect} />)

    await user.click(getTrigger())
    await user.type(screen.getByRole('searchbox', { name: 'common.operation.search' }), 'john')

    expect(screen.getByRole('button', { name: /John/ })).toBeInTheDocument()
  })

  it.each([
    ['Enter', '{Enter}'],
    ['Space', ' '],
  ])('should open the dropdown with the %s key', async (_, key) => {
    const user = userEvent.setup()
    render(<MemberSelector onSelect={mockOnSelect} />)

    const trigger = getTrigger()
    trigger.focus()
    await user.keyboard(key)

    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(getMemberButtons()).toHaveLength(3)
  })

  it.each([
    ['Enter', '{Enter}'],
    ['Space', ' '],
  ])('should select a member with the %s key', async (_, key) => {
    const user = userEvent.setup()
    render(<MemberSelector onSelect={mockOnSelect} />)

    await user.click(getTrigger())
    const jane = screen.getByRole('button', { name: /Jane Smith.*jane@example\.com/ })
    jane.focus()
    await user.keyboard(key)

    expect(mockOnSelect).toHaveBeenCalledWith('2')
    expect(
      screen.queryByRole('searchbox', { name: 'common.operation.search' }),
    ).not.toBeInTheDocument()
  })
})
