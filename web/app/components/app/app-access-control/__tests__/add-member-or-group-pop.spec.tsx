import type { AccessControlAccount, AccessControlGroup, Subject } from '@/models/access-control'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import useAccessControlStore from '@/context/access-control-store'
import { SubjectType } from '@/models/access-control'
import AddMemberOrGroupDialog from '../add-member-or-group-pop'

const mockUseSearchForWhiteListCandidates = vi.fn()
const intersectionObserverMocks = vi.hoisted(() => ({
  callback: null as null | ((entries: Array<{ isIntersecting: boolean }>) => void),
}))

vi.mock('@/context/app-context', () => ({
  useSelector: <T,>(selector: (value: { userProfile: { email: string } }) => T) => selector({
    userProfile: {
      email: 'member@example.com',
    },
  }),
}))

vi.mock('@/service/access-control', () => ({
  useSearchForWhiteListCandidates: (...args: unknown[]) => mockUseSearchForWhiteListCandidates(...args),
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

describe('AddMemberOrGroupDialog', () => {
  const baseGroup = createGroup()
  const baseMember = createMember()
  const groupSubject: Subject = {
    subjectId: baseGroup.id,
    subjectType: SubjectType.GROUP,
    groupData: baseGroup,
  } as Subject
  const memberSubject: Subject = {
    subjectId: baseMember.id,
    subjectType: SubjectType.ACCOUNT,
    accountData: baseMember,
  } as Subject

  beforeAll(() => {
    class MockIntersectionObserver {
      constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
        intersectionObserverMocks.callback = callback
      }

      observe = vi.fn(() => undefined)
      disconnect = vi.fn(() => undefined)
      unobserve = vi.fn(() => undefined)
    }

    // @ts-expect-error test DOM typings do not guarantee IntersectionObserver here
    globalThis.IntersectionObserver = MockIntersectionObserver
  })

  beforeEach(() => {
    vi.clearAllMocks()
    useAccessControlStore.setState({
      appId: 'app-1',
      specificGroups: [],
      specificMembers: [],
      currentMenu: SubjectType.GROUP as never,
      selectedGroupsForBreadcrumb: [],
    })
    mockUseSearchForWhiteListCandidates.mockReturnValue({
      isLoading: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      data: {
        pages: [{ currPage: 1, subjects: [groupSubject, memberSubject], hasMore: false }],
      },
    })
  })

  it('should open the search popover and display candidates', async () => {
    const user = userEvent.setup()
    render(<AddMemberOrGroupDialog />)

    await user.click(screen.getByText('common.operation.add'))

    expect(screen.getByPlaceholderText('app.accessControlDialog.operateGroupAndMember.searchPlaceholder')).toBeInTheDocument()
    expect(screen.getByText(baseGroup.name)).toBeInTheDocument()
    expect(screen.getByText(baseMember.name)).toBeInTheDocument()
  })

  it('should allow expanding groups and selecting members', async () => {
    const user = userEvent.setup()
    render(<AddMemberOrGroupDialog />)

    await user.click(screen.getByText('common.operation.add'))
    await user.click(screen.getByText('app.accessControlDialog.operateGroupAndMember.expand'))

    expect(useAccessControlStore.getState().selectedGroupsForBreadcrumb).toEqual([baseGroup])

    const memberCheckbox = screen.getByText(baseMember.name).parentElement?.previousElementSibling as HTMLElement
    fireEvent.click(memberCheckbox)

    expect(useAccessControlStore.getState().specificMembers).toEqual([baseMember])
  })

  it('should show the empty state when no candidates are returned', async () => {
    mockUseSearchForWhiteListCandidates.mockReturnValue({
      isLoading: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      data: { pages: [] },
    })

    const user = userEvent.setup()
    render(<AddMemberOrGroupDialog />)

    await user.click(screen.getByText('common.operation.add'))

    expect(screen.getByText('app.accessControlDialog.operateGroupAndMember.noResult')).toBeInTheDocument()
  })
})
