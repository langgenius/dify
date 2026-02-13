import type { Member } from '@/models/common'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { vi } from 'vitest'
import { useMembers } from '@/service/use-common'
import MemberSelector from './member-selector'

vi.mock('@/service/use-common')

const MemberSelectorHarness = ({ initialValue = '', exclude = [] as string[] }: { initialValue?: string, exclude?: string[] }) => {
  const [selected, setSelected] = useState<string>(initialValue)
  return (
    <>
      <MemberSelector value={selected} onSelect={setSelected} exclude={exclude} />
      {selected && (
        <div>
          Selected:
          {' '}
          {selected}
        </div>
      )}
    </>
  )
}

describe('MemberSelector', () => {
  const mockMembers = [
    { id: '1', name: 'User 1', email: 'user1@example.com', role: 'admin' },
    { id: '2', name: 'User 2', email: 'user2@example.com', role: 'normal' },
  ] as Member[]

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useMembers).mockReturnValue({
      data: { accounts: mockMembers },
    } as unknown as ReturnType<typeof useMembers>)
  })

  it('should show member options when selector is opened', async () => {
    const user = userEvent.setup()

    render(<MemberSelectorHarness />)

    await user.click(screen.getByText(/members\.transferModal\.transferPlaceholder/i))

    expect(screen.getByPlaceholderText(/common\.operation\.search/i)).toBeInTheDocument()
    expect(screen.getByText('User 1')).toBeInTheDocument()
    expect(screen.getByText('User 2')).toBeInTheDocument()
  })

  it('should filter displayed members by search term', async () => {
    const user = userEvent.setup()

    render(<MemberSelectorHarness />)

    await user.click(screen.getByText(/members\.transferModal\.transferPlaceholder/i))
    await user.type(screen.getByPlaceholderText(/common\.operation\.search/i), 'User 2')

    expect(screen.queryByText('User 1')).not.toBeInTheDocument()
    expect(screen.getByText('User 2')).toBeInTheDocument()
  })

  it('should show selected member after clicking an option', async () => {
    const user = userEvent.setup()

    render(<MemberSelectorHarness />)

    await user.click(screen.getByText(/members\.transferModal\.transferPlaceholder/i))
    await user.click(screen.getByText('User 1'))

    expect(screen.getByText('Selected: 1')).toBeInTheDocument()
  })

  it('should show selected value details when an initial value is provided', () => {
    render(<MemberSelectorHarness initialValue="2" />)

    expect(screen.getByText('User 2')).toBeInTheDocument()
    expect(screen.getByText('user2@example.com')).toBeInTheDocument()
  })

  it('should hide excluded members from options', async () => {
    const user = userEvent.setup()

    render(<MemberSelectorHarness exclude={['1']} />)

    await user.click(screen.getByText(/members\.transferModal\.transferPlaceholder/i))

    expect(screen.queryByText('User 1')).not.toBeInTheDocument()
    expect(screen.getByText('User 2')).toBeInTheDocument()
  })

  it('should render empty options when member data is unavailable', async () => {
    const user = userEvent.setup()

    vi.mocked(useMembers).mockReturnValue({
      data: undefined,
    } as unknown as ReturnType<typeof useMembers>)

    render(<MemberSelectorHarness />)

    await user.click(screen.getByText(/members\.transferModal\.transferPlaceholder/i))

    expect(screen.queryByText('User 1')).not.toBeInTheDocument()
    expect(screen.queryByText('User 2')).not.toBeInTheDocument()
  })
})
