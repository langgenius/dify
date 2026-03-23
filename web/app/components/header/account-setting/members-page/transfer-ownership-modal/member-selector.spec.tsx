import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { useMembers } from '@/service/use-common'
import MemberSelector from './member-selector'

vi.mock('@/service/use-common')

const mockAccounts = [
  { id: '1', name: 'John Doe', email: 'john@example.com', avatar_url: '' },
  { id: '2', name: 'Jane Smith', email: 'jane@example.com', avatar_url: '' },
  { id: '3', name: 'Bob Wilson', email: 'bob@example.com', avatar_url: '' },
]

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
    expect(screen.getByText(/members\.transferModal\.transferPlaceholder/i)).toBeInTheDocument()
  })

  it('should render selected member info', () => {
    render(<MemberSelector value="1" onSelect={mockOnSelect} />)
    expect(screen.getByText('John Doe')).toBeInTheDocument()
    expect(screen.getByText('john@example.com')).toBeInTheDocument()
  })

  it('should open dropdown and show filtered list on click', async () => {
    const user = userEvent.setup()
    render(<MemberSelector onSelect={mockOnSelect} exclude={['1']} />)

    await user.click(screen.getByTestId('member-selector-trigger'))

    const items = screen.getAllByTestId('member-selector-item')
    expect(items).toHaveLength(2) // Jane and Bob (John excluded)
    expect(screen.queryByText('John Doe')).not.toBeInTheDocument()
    expect(screen.getByText('Jane Smith')).toBeInTheDocument()
  })

  it('should filter list by search value', async () => {
    const user = userEvent.setup()
    render(<MemberSelector onSelect={mockOnSelect} />)

    await user.click(screen.getByTestId('member-selector-trigger'))
    await user.type(screen.getByTestId('member-selector-search'), 'Jane')

    const items = screen.getAllByTestId('member-selector-item')
    expect(items).toHaveLength(1)
    expect(screen.getByText('Jane Smith')).toBeInTheDocument()
    expect(screen.queryByText('Bob Wilson')).not.toBeInTheDocument()
  })

  it('should call onSelect and close dropdown when an item is clicked', async () => {
    const user = userEvent.setup()
    render(<MemberSelector onSelect={mockOnSelect} />)

    await user.click(screen.getByTestId('member-selector-trigger'))
    await user.click(screen.getByText('Jane Smith'))

    expect(mockOnSelect).toHaveBeenCalledWith('2')
    await waitFor(() => {
      expect(screen.queryByTestId('member-selector-search')).not.toBeInTheDocument()
    })
  })

  it('should handle missing data gracefully', () => {
    vi.mocked(useMembers).mockReturnValue({ data: undefined } as unknown as ReturnType<typeof useMembers>)
    render(<MemberSelector onSelect={mockOnSelect} />)
    expect(screen.getByText(/members\.transferModal\.transferPlaceholder/i)).toBeInTheDocument()
  })
})
