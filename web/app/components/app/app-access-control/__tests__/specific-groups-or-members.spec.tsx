import type { AccessControlAccount, AccessControlGroup } from '@/models/access-control'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AccessMode } from '@/models/access-control'
import SpecificGroupsOrMembers from '../specific-groups-or-members'

const mockAddMemberOrGroupDialog = vi.hoisted(() => vi.fn())

vi.mock('../add-member-or-group-pop', () => ({
  default: (props: Record<string, unknown>) => {
    mockAddMemberOrGroupDialog(props)
    return null
  },
}))

const createGroup = (overrides: Partial<AccessControlGroup> = {}): AccessControlGroup =>
  ({
    id: 'group-1',
    name: 'Group One',
    groupSize: 5,
    ...overrides,
  }) as AccessControlGroup

const createMember = (overrides: Partial<AccessControlAccount> = {}): AccessControlAccount =>
  ({
    id: 'member-1',
    name: 'Member One',
    email: 'member@example.com',
    avatar: '',
    avatarUrl: '',
    ...overrides,
  }) as AccessControlAccount

describe('SpecificGroupsOrMembers', () => {
  const baseGroup = createGroup()
  const baseMember = createMember()
  const subjects = {
    groups: [baseGroup],
    members: [baseMember],
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the collapsed row when not in specific mode', () => {
    render(
      <SpecificGroupsOrMembers
        accessMode={AccessMode.ORGANIZATION}
        subjects={subjects}
        subjectsStatus="success"
        onSubjectsChange={vi.fn()}
      />,
    )

    expect(screen.getByText('app.accessControlDialog.accessItems.specific')).toBeInTheDocument()
    expect(mockAddMemberOrGroupDialog).not.toHaveBeenCalled()
  })

  it('should show loading while whitelist subjects are pending', () => {
    const { container } = render(
      <SpecificGroupsOrMembers
        accessMode={AccessMode.SPECIFIC_GROUPS_MEMBERS}
        subjects={{ groups: [], members: [] }}
        subjectsStatus="loading"
        onSubjectsChange={vi.fn()}
      />,
    )

    expect(container.querySelector('.spin-animation')).toBeInTheDocument()
    expect(mockAddMemberOrGroupDialog).not.toHaveBeenCalled()
  })

  it('should expose the failed load and allow retry without rendering an empty selection', async () => {
    const user = userEvent.setup()
    const onRetrySubjects = vi.fn()

    render(
      <SpecificGroupsOrMembers
        accessMode={AccessMode.SPECIFIC_GROUPS_MEMBERS}
        subjects={{ groups: [], members: [] }}
        subjectsStatus="error"
        onSubjectsChange={vi.fn()}
        onRetrySubjects={onRetrySubjects}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('common.dynamicSelect.error')
    expect(screen.queryByText('app.accessControlDialog.noGroupsOrMembers')).not.toBeInTheDocument()
    expect(mockAddMemberOrGroupDialog).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    expect(onRetrySubjects).toHaveBeenCalledTimes(1)
  })

  it('should render controlled groups and members and report removals', async () => {
    const user = userEvent.setup()
    const onSubjectsChange = vi.fn()

    render(
      <SpecificGroupsOrMembers
        accessMode={AccessMode.SPECIFIC_GROUPS_MEMBERS}
        subjects={subjects}
        subjectsStatus="success"
        onSubjectsChange={onSubjectsChange}
      />,
    )

    expect(screen.getByText(baseGroup.name)).toBeInTheDocument()
    expect(screen.getByText(baseMember.name)).toBeInTheDocument()

    const removeButtons = screen.getAllByRole('button', { name: /operation\.remove$/ })
    await user.click(removeButtons[0]!)
    expect(onSubjectsChange).toHaveBeenCalledWith({
      groups: [],
      members: [baseMember],
    })

    await user.click(removeButtons[1]!)
    expect(onSubjectsChange).toHaveBeenCalledWith({
      groups: [baseGroup],
      members: [],
    })
  })
})
