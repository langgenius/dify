import type { AccessControlSubjects } from '../specific-groups-or-members'
import type { AccessControlAccount, AccessControlGroup, Subject } from '@/models/access-control'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { SubjectType } from '@/models/access-control'
import { renderWithAccountProfile as render } from '@/test/console/account-profile'
import AddMemberOrGroupDialog from '../add-member-or-group-pop'

const mockUseSearchForWhiteListCandidates = vi.fn()
const intersectionObserverMocks = vi.hoisted(() => ({
  callback: null as null | ((entries: Array<{ isIntersecting: boolean }>) => void),
}))

vi.mock('@/service/access-control', () => ({
  useSearchForWhiteListCandidates: (...args: unknown[]) =>
    mockUseSearchForWhiteListCandidates(...args),
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

function ControlledDialog({
  onChange = () => {},
}: {
  onChange?: (value: AccessControlSubjects) => void
}) {
  const [subjects, setSubjects] = useState<AccessControlSubjects>({ groups: [], members: [] })

  const handleChange = (nextSubjects: AccessControlSubjects) => {
    setSubjects(nextSubjects)
    onChange(nextSubjects)
  }

  return <AddMemberOrGroupDialog subjects={subjects} onChange={handleChange} />
}

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
    render(<ControlledDialog />)

    await user.click(screen.getByText('common.operation.add'))

    const searchLabel = 'app.accessControlDialog.operateGroupAndMember.searchPlaceholder'
    expect(screen.getByRole('dialog', { name: searchLabel })).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: searchLabel })).toHaveFocus()
    expect(screen.getByText(baseGroup.name)).toBeInTheDocument()
    expect(screen.getByText(baseMember.name)).toBeInTheDocument()
  })

  it('should keep group selection and expansion as separate keyboard actions', async () => {
    const user = userEvent.setup()
    render(<ControlledDialog />)

    await user.click(screen.getByText('common.operation.add'))

    const groupToggle = screen.getByRole('button', { name: /Group One/ })
    const expandButton = screen.getByRole('button', {
      name: 'app.accessControlDialog.operateGroupAndMember.expand',
    })

    groupToggle.focus()
    await user.tab()

    expect(expandButton).toHaveFocus()
  })

  it('should allow expanding groups and report selected members', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ControlledDialog onChange={onChange} />)

    await user.click(screen.getByText('common.operation.add'))
    await user.click(screen.getByText('app.accessControlDialog.operateGroupAndMember.expand'))

    expect(mockUseSearchForWhiteListCandidates).toHaveBeenLastCalledWith(
      expect.objectContaining({ groupId: baseGroup.id }),
      true,
    )

    const memberToggle = screen.getByRole('button', { name: /Member One/ })

    expect(memberToggle).toHaveAttribute('aria-pressed', 'false')
    await user.click(memberToggle)
    expect(onChange).toHaveBeenCalledWith({ groups: [], members: [baseMember] })
    expect(memberToggle).toHaveAttribute('aria-pressed', 'true')
  })

  it('should show the empty state when no candidates are returned', async () => {
    mockUseSearchForWhiteListCandidates.mockReturnValue({
      isLoading: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      data: { pages: [] },
    })

    const user = userEvent.setup()
    render(<ControlledDialog />)

    await user.click(screen.getByText('common.operation.add'))

    expect(screen.getByRole('status')).toHaveTextContent(
      'app.accessControlDialog.operateGroupAndMember.noResult',
    )
  })

  it('should keep breadcrumbs visible when the current group has no candidates', async () => {
    mockUseSearchForWhiteListCandidates.mockImplementation((query: { groupId?: string }) => ({
      isLoading: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      data: {
        pages: [
          {
            currPage: 1,
            subjects: query.groupId ? [] : [groupSubject, memberSubject],
            hasMore: false,
          },
        ],
      },
    }))

    const user = userEvent.setup()
    render(<ControlledDialog />)
    await user.click(screen.getByText('common.operation.add'))
    await user.click(screen.getByText('app.accessControlDialog.operateGroupAndMember.expand'))

    const allMembersButton = screen.getByRole('button', {
      name: 'app.accessControlDialog.operateGroupAndMember.allMembers',
    })
    expect(allMembersButton).toBeInTheDocument()
    expect(screen.getByText(baseGroup.name)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(
      'app.accessControlDialog.operateGroupAndMember.noResult',
    )

    await user.click(allMembersButton)
    expect(mockUseSearchForWhiteListCandidates).toHaveBeenLastCalledWith(
      expect.objectContaining({ groupId: undefined }),
      true,
    )
  })
})
