import type { AccessControlAccount, AccessControlGroup, Subject } from '@/models/access-control'
import type { App } from '@/types/app'
import { AccessSubjectType as EnterpriseSubjectType } from '@dify/contracts/enterprise/types.gen'
import { toast } from '@langgenius/dify-ui/toast'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithSystemFeatures as render } from '@/__tests__/utils/mock-system-features'
import { AccessMode, SubjectType } from '@/models/access-control'
import { AccessControlDialog } from '../access-control-dialog'
import { AccessControlItem } from '../access-control-item'
import { AddMemberOrGroupDialog } from '../add-member-or-group-pop'
import { AccessControl } from '../index'
import { SpecificGroupsOrMembers } from '../specific-groups-or-members'
import { AccessControlRadioGroupHarness } from './access-control-radio-group-harness'
import { createAccessControlDraftHarness } from './access-control-test-utils'

const mockUseAppWhiteListSubjects = vi.fn()
const mockUseSearchForWhiteListCandidates = vi.fn()
const mockMutate = vi.fn()
const mockUseMutation = vi.hoisted(() => vi.fn())
const intersectionObserverMocks = vi.hoisted(() => ({
  callback: null as null | ((entries: Array<{ isIntersecting: boolean }>) => void),
}))

vi.mock('@/context/app-context', () => ({
  useSelector: <T,>(selector: (value: { userProfile: { email: string, id?: string, name?: string, avatar?: string, avatar_url?: string, is_password_set?: boolean } }) => T) => selector({
    userProfile: {
      id: 'current-user',
      name: 'Current User',
      email: 'member@example.com',
      avatar: '',
      avatar_url: '',
      is_password_set: true,
    },
  }),
}))

vi.mock('@/service/access-control/use-app-access-control', () => ({
  useAppWhiteListSubjects: (...args: unknown[]) => mockUseAppWhiteListSubjects(...args),
  useSearchForWhiteListCandidates: (...args: unknown[]) => mockUseSearchForWhiteListCandidates(...args),
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useMutation: (...args: unknown[]) => mockUseMutation(...args),
  }
})

vi.mock('ahooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ahooks')>()
  return {
    ...actual,
    useDebounce: (value: unknown) => value,
  }
})

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
  mockMutate.mockImplementation((_: unknown, options?: { onSuccess?: () => void }) => {
    options?.onSuccess?.()
  })
  mockUseMutation.mockReturnValue({
    isPending: false,
    mutate: mockMutate,
  })
  mockUseAppWhiteListSubjects.mockReturnValue({
    isPending: false,
    data: {
      groups: [baseGroup],
      members: [baseMember],
    },
  })
  mockUseSearchForWhiteListCandidates.mockReturnValue({
    isLoading: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    data: { pages: [{ currPage: 1, subjects: [groupSubject, memberSubject], hasMore: false }] },
  })
})

// AccessControlItem handles selected vs. unselected styling and click state updates
describe('AccessControlItem', () => {
  it('should update current menu when selecting a different access type', () => {
    const harness = createAccessControlDraftHarness(
      <AccessControlRadioGroupHarness>
        <AccessControlItem type={AccessMode.ORGANIZATION}>
          <span>Organization Only</span>
        </AccessControlItem>
      </AccessControlRadioGroupHarness>,
      { currentMenu: AccessMode.PUBLIC },
    )
    render(harness.element)

    const option = screen.getByRole('radio', { name: 'Organization Only' })
    expect(option).toHaveClass('cursor-pointer')

    fireEvent.click(option)

    expect(harness.getSnapshot().currentMenu).toBe(AccessMode.ORGANIZATION)
  })

  it('should keep current menu when clicking the selected access type', () => {
    const harness = createAccessControlDraftHarness(
      <AccessControlRadioGroupHarness>
        <AccessControlItem type={AccessMode.ORGANIZATION}>
          <span>Organization Only</span>
        </AccessControlItem>
      </AccessControlRadioGroupHarness>,
      { currentMenu: AccessMode.ORGANIZATION },
    )
    render(harness.element)

    const option = screen.getByRole('radio', { name: 'Organization Only' })
    fireEvent.click(option)

    expect(harness.getSnapshot().currentMenu).toBe(AccessMode.ORGANIZATION)
  })
})

// AccessControlDialog renders the shared dialog primitive with a close control.
describe('AccessControlDialog', () => {
  it('should render dialog content when visible', () => {
    render(
      <AccessControlDialog show className="custom-dialog">
        <div>Dialog Content</div>
      </AccessControlDialog>,
    )

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Dialog Content')).toBeInTheDocument()
  })

  it('should trigger onClose when clicking the close control', async () => {
    const handleClose = vi.fn()
    render(
      <AccessControlDialog show onClose={handleClose}>
        <div>Dialog Content</div>
      </AccessControlDialog>,
    )

    const closeButton = screen.getByRole('button', { name: 'Close' })
    fireEvent.click(closeButton)

    await waitFor(() => {
      expect(handleClose).toHaveBeenCalledTimes(1)
    })
  })
})

// SpecificGroupsOrMembers syncs store state with fetched data and supports removals
describe('SpecificGroupsOrMembers', () => {
  it('should render collapsed view when not in specific selection mode', () => {
    const harness = createAccessControlDraftHarness(
      <SpecificGroupsOrMembers />,
      { currentMenu: AccessMode.ORGANIZATION },
    )

    render(harness.element)

    expect(screen.getByText('app.accessControlDialog.accessItems.specific')).toBeInTheDocument()
    expect(screen.queryByText(baseGroup.name)).not.toBeInTheDocument()
  })

  it('should show loading state while pending', async () => {
    const harness = createAccessControlDraftHarness(
      <SpecificGroupsOrMembers loading />,
      { appId: 'app-1', currentMenu: AccessMode.SPECIFIC_GROUPS_MEMBERS },
    )

    render(harness.element)

    expect(screen.getByRole('status', { name: 'common.loading' })).toBeInTheDocument()
  })

  it('should render fetched groups and members and support removal', async () => {
    const harness = createAccessControlDraftHarness(
      <SpecificGroupsOrMembers />,
      {
        appId: 'app-1',
        currentMenu: AccessMode.SPECIFIC_GROUPS_MEMBERS,
        specificGroups: [baseGroup],
        specificMembers: [baseMember],
      },
    )

    render(harness.element)

    await waitFor(() => {
      expect(screen.getByText(baseGroup.name)).toBeInTheDocument()
      expect(screen.getByText(baseMember.name)).toBeInTheDocument()
    })

    const groupRemove = screen.getAllByRole('button', { name: /operation\.remove$/ })[0]!

    fireEvent.click(groupRemove)

    await waitFor(() => {
      expect(screen.queryByText(baseGroup.name)).not.toBeInTheDocument()
    })

    const memberRemove = screen.getAllByRole('button', { name: /operation\.remove$/ })[0]!

    fireEvent.click(memberRemove)

    await waitFor(() => {
      expect(screen.queryByText(baseMember.name)).not.toBeInTheDocument()
    })
  })
})

// AddMemberOrGroupDialog renders search results and updates store selections
describe('AddMemberOrGroupDialog', () => {
  it('should open search popover and display candidates', async () => {
    const user = userEvent.setup()
    const harness = createAccessControlDraftHarness(
      <AddMemberOrGroupDialog />,
      { appId: 'app-1', currentMenu: AccessMode.SPECIFIC_GROUPS_MEMBERS },
    )

    render(harness.element)

    await user.click(screen.getByText('common.operation.add'))

    expect(screen.getByPlaceholderText('app.accessControlDialog.operateGroupAndMember.searchPlaceholder')).toBeInTheDocument()
    expect(screen.getByText(baseGroup.name)).toBeInTheDocument()
    expect(screen.getByText(baseMember.name)).toBeInTheDocument()
  })

  it('should allow selecting members and expanding groups', async () => {
    const user = userEvent.setup()
    const harness = createAccessControlDraftHarness(
      <AddMemberOrGroupDialog />,
      { appId: 'app-1', currentMenu: AccessMode.SPECIFIC_GROUPS_MEMBERS },
    )
    render(harness.element)

    await user.click(screen.getByText('common.operation.add'))

    const expandButton = screen.getByText('app.accessControlDialog.operateGroupAndMember.expand')
    await user.click(expandButton)
    expect(harness.getSnapshot().selectedGroupsForBreadcrumb).toEqual([baseGroup])

    await user.click(screen.getByRole('option', { name: /Member One/ }))

    expect(harness.getSnapshot().specificMembers).toEqual([baseMember])
  })

  it('should update the keyword, fetch the next page, and support deselection and breadcrumb reset', async () => {
    const fetchNextPage = vi.fn()
    mockUseSearchForWhiteListCandidates.mockReturnValue({
      isLoading: false,
      isFetchingNextPage: true,
      fetchNextPage,
      data: { pages: [{ currPage: 1, subjects: [groupSubject, memberSubject], hasMore: true }] },
    })

    const user = userEvent.setup()
    const harness = createAccessControlDraftHarness(
      <AddMemberOrGroupDialog />,
      { appId: 'app-1', currentMenu: AccessMode.SPECIFIC_GROUPS_MEMBERS },
    )
    render(harness.element)

    await user.click(screen.getByText('common.operation.add'))
    await user.type(screen.getByPlaceholderText('app.accessControlDialog.operateGroupAndMember.searchPlaceholder'), 'Group')
    expect(document.querySelector('.spin-animation')).toBeInTheDocument()

    const groupOption = screen.getByRole('option', { name: /Group One/ })
    fireEvent.click(groupOption)
    fireEvent.click(groupOption)

    const memberOption = screen.getByRole('option', { name: /Member One/ })
    fireEvent.click(memberOption)
    fireEvent.click(memberOption)

    fireEvent.click(screen.getByText('app.accessControlDialog.operateGroupAndMember.expand'))
    fireEvent.click(screen.getByText('app.accessControlDialog.operateGroupAndMember.allMembers'))

    expect(harness.getSnapshot().specificGroups).toEqual([])
    expect(harness.getSnapshot().specificMembers).toEqual([])
    expect(harness.getSnapshot().selectedGroupsForBreadcrumb).toEqual([])
    expect(fetchNextPage).not.toHaveBeenCalled()
  })

  it('should show empty state when no candidates are returned', async () => {
    mockUseSearchForWhiteListCandidates.mockReturnValue({
      isLoading: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      data: { pages: [] },
    })

    const user = userEvent.setup()
    const harness = createAccessControlDraftHarness(
      <AddMemberOrGroupDialog />,
      { appId: 'app-1', currentMenu: AccessMode.SPECIFIC_GROUPS_MEMBERS },
    )
    render(harness.element)

    await user.click(screen.getByText('common.operation.add'))

    expect(screen.getByRole('status')).toHaveTextContent('app.accessControlDialog.operateGroupAndMember.noResult')
  })
})

// AccessControl integrates dialog, selection items, and confirm flow
describe('AccessControl', () => {
  it('should initialize menu from app and call update on confirm', async () => {
    const onClose = vi.fn()
    const onConfirm = vi.fn()
    const toastSpy = vi.spyOn(toast, 'success').mockReturnValue('toast-success')
    const app = {
      id: 'app-id-1',
      access_mode: AccessMode.SPECIFIC_GROUPS_MEMBERS,
    } as App

    render(
      <AccessControl
        app={app}
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    )

    fireEvent.click(screen.getByText('common.operation.confirm'))

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledWith(
        {
          body: {
            appId: app.id,
            accessMode: AccessMode.SPECIFIC_GROUPS_MEMBERS,
            subjects: [
              { subjectId: baseGroup.id, subjectType: EnterpriseSubjectType.ACCESS_SUBJECT_TYPE_GROUP },
              { subjectId: baseMember.id, subjectType: EnterpriseSubjectType.ACCESS_SUBJECT_TYPE_ACCOUNT },
            ],
          },
        },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      )
      expect(toastSpy).toHaveBeenCalledWith('app.accessControlDialog.updateSuccess')
      expect(onConfirm).toHaveBeenCalled()
    })
  })

  it('should expose the external members tip when SSO is disabled', () => {
    const app = {
      id: 'app-id-2',
      access_mode: AccessMode.PUBLIC,
    } as App

    render(
      <AccessControl
        app={app}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('app.accessControlDialog.accessItems.external')).toBeInTheDocument()
    expect(screen.getByText('app.accessControlDialog.accessItems.anyone')).toBeInTheDocument()
  })
})
