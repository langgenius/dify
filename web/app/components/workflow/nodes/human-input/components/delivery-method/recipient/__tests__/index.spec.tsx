import { fireEvent, render, screen } from '@testing-library/react'
import Recipient from '../index'

const mockUseTranslation = vi.hoisted(() => vi.fn())
const mockUseAppContext = vi.hoisted(() => vi.fn())
const mockUseMembers = vi.hoisted(() => vi.fn())

vi.mock('react-i18next', () => ({
  useTranslation: () => mockUseTranslation(),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => mockUseAppContext(),
}))

vi.mock('@/service/use-common', () => ({
  useMembers: () => mockUseMembers(),
}))

vi.mock('@/app/components/base/switch', () => ({
  __esModule: true,
  default: (props: {
    checked: boolean
    onCheckedChange: (value: boolean) => void
  }) => (
    <button type="button" onClick={() => props.onCheckedChange(!props.checked)}>
      toggle-workspace
    </button>
  ),
}))

vi.mock('../member-selector', () => ({
  __esModule: true,
  default: ({ onSelect }: { onSelect: (id: string) => void }) => (
    <button type="button" onClick={() => onSelect('member-2')}>
      add-member
    </button>
  ),
}))

vi.mock('../email-input', () => ({
  __esModule: true,
  default: (props: {
    onAdd: (email: string) => void
    onSelect: (id: string) => void
    onDelete: (recipient: { type: 'member' | 'external', user_id?: string, email?: string }) => void
  }) => (
    <div>
      <button type="button" onClick={() => props.onAdd('new@example.com')}>
        add-email
      </button>
      <button type="button" onClick={() => props.onSelect('member-3')}>
        add-email-member
      </button>
      <button type="button" onClick={() => props.onDelete({ type: 'member', user_id: 'member-1' })}>
        delete-member
      </button>
      <button type="button" onClick={() => props.onDelete({ type: 'external', email: 'external@example.com' })}>
        delete-external
      </button>
    </div>
  ),
}))

describe('Recipient', () => {
  const onChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTranslation.mockReturnValue({
      t: (key: string, options?: { workspaceName?: string }) => options?.workspaceName ?? key,
    })
    mockUseAppContext.mockReturnValue({
      userProfile: { email: 'owner@example.com' },
      currentWorkspace: { name: 'Dify\'s Lab' },
    })
    mockUseMembers.mockReturnValue({
      data: {
        accounts: [
          { id: 'member-1', email: 'member-1@example.com', name: 'Member One' },
          { id: 'member-2', email: 'member-2@example.com', name: 'Member Two' },
          { id: 'member-3', email: 'member-3@example.com', name: 'Member Three' },
        ],
      },
    })
  })

  it('should render workspace details and update recipients through member/email actions', () => {
    render(
      <Recipient
        data={{
          whole_workspace: false,
          items: [
            { type: 'member', user_id: 'member-1' },
            { type: 'external', email: 'external@example.com' },
          ],
        }}
        onChange={onChange}
      />,
    )

    expect(screen.getByText('D')).toBeInTheDocument()
    expect(screen.getByText('Dify’s Lab')).toBeInTheDocument()

    fireEvent.click(screen.getByText('add-member'))
    fireEvent.click(screen.getByText('add-email'))
    fireEvent.click(screen.getByText('add-email-member'))
    fireEvent.click(screen.getByText('delete-member'))
    fireEvent.click(screen.getByText('delete-external'))
    fireEvent.click(screen.getByText('toggle-workspace'))

    expect(onChange).toHaveBeenNthCalledWith(1, {
      whole_workspace: false,
      items: [
        { type: 'member', user_id: 'member-1' },
        { type: 'external', email: 'external@example.com' },
        { type: 'member', user_id: 'member-2' },
      ],
    })
    expect(onChange).toHaveBeenNthCalledWith(2, {
      whole_workspace: false,
      items: [
        { type: 'member', user_id: 'member-1' },
        { type: 'external', email: 'external@example.com' },
        { type: 'external', email: 'new@example.com' },
      ],
    })
    expect(onChange).toHaveBeenNthCalledWith(3, {
      whole_workspace: false,
      items: [
        { type: 'member', user_id: 'member-1' },
        { type: 'external', email: 'external@example.com' },
        { type: 'member', user_id: 'member-3' },
      ],
    })
    expect(onChange).toHaveBeenNthCalledWith(4, {
      whole_workspace: false,
      items: [
        { type: 'external', email: 'external@example.com' },
      ],
    })
    expect(onChange).toHaveBeenNthCalledWith(5, {
      whole_workspace: false,
      items: [
        { type: 'member', user_id: 'member-1' },
      ],
    })
    expect(onChange).toHaveBeenNthCalledWith(6, {
      whole_workspace: true,
      items: [
        { type: 'member', user_id: 'member-1' },
        { type: 'external', email: 'external@example.com' },
      ],
    })
  })
})
