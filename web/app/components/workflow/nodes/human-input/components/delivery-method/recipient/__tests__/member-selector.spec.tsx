import type { Member } from '@/models/common'
import { fireEvent, render, screen } from '@testing-library/react'
import MemberSelector from '../member-selector'

vi.mock('@langgenius/dify-ui/popover', async () => {
  const React = await import('react')
  const PopoverContext = React.createContext({
    open: false,
    setOpen: (_open: boolean) => {},
  })

  const Popover = ({
    children,
    open: controlledOpen,
    onOpenChange,
  }: {
    children: import('react').ReactNode
    open?: boolean
    onOpenChange?: (open: boolean) => void
  }) => {
    const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false)
    const isControlled = controlledOpen !== undefined
    const open = isControlled ? !!controlledOpen : uncontrolledOpen
    const setOpen = (nextOpen: boolean) => {
      if (!isControlled)
        setUncontrolledOpen(nextOpen)
      onOpenChange?.(nextOpen)
    }

    return (
      <PopoverContext.Provider value={{ open, setOpen }}>
        {children}
      </PopoverContext.Provider>
    )
  }

  const PopoverTrigger = ({ render }: { render: import('react').ReactNode }) => {
    const { open, setOpen } = React.useContext(PopoverContext)
    return (
      <div onClick={() => setOpen(!open)}>
        {render}
      </div>
    )
  }

  const PopoverContent = ({ children }: { children: import('react').ReactNode }) => {
    const { open } = React.useContext(PopoverContext)
    return open ? <div data-testid="popover-content">{children}</div> : null
  }

  return {
    Popover,
    PopoverTrigger,
    PopoverContent,
  }
})

const mockMemberList = vi.hoisted(() => vi.fn())

vi.mock('../member-list', () => ({
  __esModule: true,
  default: (props: {
    searchValue: string
    list: Member[]
    email: string
  }) => {
    mockMemberList(props)
    return <div data-testid="member-list" />
  },
}))

const members: Member[] = [{
  id: 'member-1',
  email: 'member-1@example.com',
  name: 'Member One',
  avatar: 'avatar-data',
  avatar_url: 'avatar.png',
  status: 'active',
  role: 'normal',
  created_at: '2026-01-01T00:00:00Z',
  last_active_at: '2026-01-02T00:00:00Z',
  last_login_at: '2026-01-03T00:00:00Z',
}]

describe('human-input/delivery-method/recipient/member-selector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should toggle the member list and forward selection props', () => {
    render(
      <MemberSelector
        value={[{ type: 'member', user_id: 'member-1' }]}
        email="owner@example.com"
        onSelect={vi.fn()}
        list={members}
      />,
    )

    const trigger = screen.getByRole('button', {
      name: 'workflow.nodes.humanInput.deliveryMethod.emailConfigure.memberSelector.trigger',
    })

    expect(screen.queryByTestId('member-list')).not.toBeInTheDocument()

    fireEvent.click(trigger)
    expect(screen.getByTestId('member-list')).toBeInTheDocument()
    expect(trigger).toHaveClass('bg-state-accent-hover')
    expect(mockMemberList).toHaveBeenCalledWith(expect.objectContaining({
      searchValue: '',
      list: members,
      email: 'owner@example.com',
    }))

    fireEvent.click(trigger)
    expect(screen.queryByTestId('member-list')).not.toBeInTheDocument()
  })
})
