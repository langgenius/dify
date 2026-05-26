import type { AccessControlAccount, AccessControlGroup } from '@/models/access-control'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import useAccessControlStore from '@/context/access-control-store'
import { AccessMode } from '@/models/access-control'
import SpecificGroupsOrMembers from '../specific-groups-or-members'

const mockUseAppWhiteListSubjects = vi.fn()

vi.mock('@/service/access-control', () => ({
  useAppWhiteListSubjects: (...args: unknown[]) => mockUseAppWhiteListSubjects(...args),
}))

vi.mock('../add-member-or-group-pop', () => ({
  default: () => <div data-testid="add-member-or-group-dialog" />,
}))

const createGroup = (overrides: Partial<AccessControlGroup> = {}): AccessControlGroup => ({
  id: 'group-1',
  name: 'Group One',
  groupSize: 5,
  ...overrides,
} as AccessControlGroup)

const createMember = (overrides: Partial<AccessControlAccount> = {}): AccessControlAccount => ({
  id: 'member-1',
  name: 'Member One',
  email: 'member@example.com',
  avatar: '',
  avatarUrl: '',
  ...overrides,
} as AccessControlAccount)

describe('SpecificGroupsOrMembers', () => {
  const baseGroup = createGroup()
  const baseMember = createMember()

  beforeEach(() => {
    vi.clearAllMocks()
    useAccessControlStore.setState({
      appId: '',
      specificGroups: [],
      specificMembers: [],
      currentMenu: AccessMode.SPECIFIC_GROUPS_MEMBERS,
      selectedGroupsForBreadcrumb: [],
    })
    mockUseAppWhiteListSubjects.mockReturnValue({
      isPending: false,
      data: {
        groups: [baseGroup],
        members: [baseMember],
      },
    })
  })

  it('should render the collapsed row when not in specific mode', () => {
    useAccessControlStore.setState({
      currentMenu: AccessMode.ORGANIZATION,
    })

    render(<SpecificGroupsOrMembers />)

    expect(screen.getByText('app.accessControlDialog.accessItems.specific')).toBeInTheDocument()
    expect(screen.queryByTestId('add-member-or-group-dialog')).not.toBeInTheDocument()
  })

  it('should show loading while whitelist subjects are pending', async () => {
    mockUseAppWhiteListSubjects.mockReturnValue({
      isPending: true,
      data: undefined,
    })

    const { container } = render(<SpecificGroupsOrMembers />)

    await waitFor(() => {
      expect(container.querySelector('.spin-animation')).toBeInTheDocument()
    })
  })

  it('should render fetched groups and members and support removal', async () => {
    useAccessControlStore.setState({ appId: 'app-1' })

    render(<SpecificGroupsOrMembers />)

    await waitFor(() => {
      expect(screen.getByText(baseGroup.name)).toBeInTheDocument()
      expect(screen.getByText(baseMember.name)).toBeInTheDocument()
    })

    const removeButtons = screen.getAllByRole('button', { name: /operation\.remove$/ })
    const groupRemove = removeButtons[0]!
    const memberRemove = removeButtons[1]!

    fireEvent.click(groupRemove)
    expect(useAccessControlStore.getState().specificGroups).toEqual([])

    fireEvent.click(memberRemove)
    expect(useAccessControlStore.getState().specificMembers).toEqual([])
  })
})
