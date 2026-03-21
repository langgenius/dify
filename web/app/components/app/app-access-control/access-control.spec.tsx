import type { AccessControlAccount, AccessControlGroup, Subject } from '@/models/access-control'
import type { App } from '@/types/app'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import useAccessControlStore from '@/context/access-control-store'
import { AccessMode, SubjectType } from '@/models/access-control'
import Toast from '../../base/toast'
import AccessControlDialog from './access-control-dialog'
import AccessControlItem from './access-control-item'
import AddMemberOrGroupDialog from './add-member-or-group-pop'
import AccessControl from './index'
import SpecificGroupsOrMembers from './specific-groups-or-members'

const mockUseAppWhiteListSubjects = vi.fn()
const mockUseSearchForWhiteListCandidates = vi.fn()
const mockMutateAsync = vi.fn()
const mockUseUpdateAccessMode = vi.fn(() => ({
  isPending: false,
  mutateAsync: mockMutateAsync,
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

vi.mock('@/service/access-control', () => ({
  useAppWhiteListSubjects: (...args: unknown[]) => mockUseAppWhiteListSubjects(...args),
  useSearchForWhiteListCandidates: (...args: unknown[]) => mockUseSearchForWhiteListCandidates(...args),
  useUpdateAccessMode: () => mockUseUpdateAccessMode(),
}))

vi.mock('@headlessui/react', () => {
  const DialogComponent: any = ({ children, className, ...rest }: any) => (
    <div role="dialog" className={className} {...rest}>{children}</div>
  )
  DialogComponent.Panel = ({ children, className, ...rest }: any) => (
    <div className={className} {...rest}>{children}</div>
  )
  const DialogTitle = ({ children, className, ...rest }: any) => (
    <div className={className} {...rest}>{children}</div>
  )
  const DialogDescription = ({ children, className, ...rest }: any) => (
    <div className={className} {...rest}>{children}</div>
  )
  const TransitionChild = ({ children }: any) => (
    <>{typeof children === 'function' ? children({}) : children}</>
  )
  const Transition = ({ show = true, children }: any) => (
    show ? <>{typeof children === 'function' ? children({}) : children}</> : null
  )
  Transition.Child = TransitionChild
  return {
    Dialog: DialogComponent,
    Transition,
    DialogTitle,
    Description: DialogDescription,
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
    observe = vi.fn(() => undefined)
    disconnect = vi.fn(() => undefined)
    unobserve = vi.fn(() => undefined)
  }
  // @ts-expect-error jsdom does not implement IntersectionObserver
  globalThis.IntersectionObserver = MockIntersectionObserver
})

beforeEach(() => {
  mockMutateAsync.mockResolvedValue(undefined)
  mockUseUpdateAccessMode.mockReturnValue({
    isPending: false,
    mutateAsync: mockMutateAsync,
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
    useAccessControlStore.setState({ currentMenu: AccessMode.PUBLIC })
    render(
      <AccessControlItem type={AccessMode.ORGANIZATION}>
        <span>Organization Only</span>
      </AccessControlItem>,
    )

    const option = screen.getByText('Organization Only').parentElement as HTMLElement
    expect(option).toHaveClass('cursor-pointer')

    fireEvent.click(option)

    expect(useAccessControlStore.getState().currentMenu).toBe(AccessMode.ORGANIZATION)
  })

  it('should keep current menu when clicking the selected access type', () => {
    useAccessControlStore.setState({ currentMenu: AccessMode.ORGANIZATION })
    render(
      <AccessControlItem type={AccessMode.ORGANIZATION}>
        <span>Organization Only</span>
      </AccessControlItem>,
    )

    const option = screen.getByText('Organization Only').parentElement as HTMLElement
    fireEvent.click(option)

    expect(useAccessControlStore.getState().currentMenu).toBe(AccessMode.ORGANIZATION)
  })
})

// AccessControlDialog renders a headless UI dialog with a manual close control
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
    const { container } = render(
      <AccessControlDialog show onClose={handleClose}>
        <div>Dialog Content</div>
      </AccessControlDialog>,
    )

    const closeButton = container.querySelector('.absolute.right-5.top-5') as HTMLElement
    fireEvent.click(closeButton)

    await waitFor(() => {
      expect(handleClose).toHaveBeenCalledTimes(1)
    })
  })
})

// SpecificGroupsOrMembers syncs store state with fetched data and supports removals
describe('SpecificGroupsOrMembers', () => {
  it('should render collapsed view when not in specific selection mode', () => {
    useAccessControlStore.setState({ currentMenu: AccessMode.ORGANIZATION })

    render(<SpecificGroupsOrMembers />)

    expect(screen.getByText('app.accessControlDialog.accessItems.specific')).toBeInTheDocument()
    expect(screen.queryByText(baseGroup.name)).not.toBeInTheDocument()
  })

  it('should show loading state while pending', async () => {
    useAccessControlStore.setState({ appId: 'app-1', currentMenu: AccessMode.SPECIFIC_GROUPS_MEMBERS })
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
    useAccessControlStore.setState({ appId: 'app-1', currentMenu: AccessMode.SPECIFIC_GROUPS_MEMBERS })

    render(<SpecificGroupsOrMembers />)

    await waitFor(() => {
      expect(screen.getByText(baseGroup.name)).toBeInTheDocument()
      expect(screen.getByText(baseMember.name)).toBeInTheDocument()
    })

    const groupItem = screen.getByText(baseGroup.name).closest('div')
    const groupRemove = groupItem?.querySelector('.h-4.w-4.cursor-pointer') as HTMLElement
    fireEvent.click(groupRemove)

    await waitFor(() => {
      expect(screen.queryByText(baseGroup.name)).not.toBeInTheDocument()
    })

    const memberItem = screen.getByText(baseMember.name).closest('div')
    const memberRemove = memberItem?.querySelector('.h-4.w-4.cursor-pointer') as HTMLElement
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

    render(<AddMemberOrGroupDialog />)

    await user.click(screen.getByText('common.operation.add'))

    expect(screen.getByPlaceholderText('app.accessControlDialog.operateGroupAndMember.searchPlaceholder')).toBeInTheDocument()
    expect(screen.getByText(baseGroup.name)).toBeInTheDocument()
    expect(screen.getByText(baseMember.name)).toBeInTheDocument()
  })

  it('should allow selecting members and expanding groups', async () => {
    const user = userEvent.setup()
    render(<AddMemberOrGroupDialog />)

    await user.click(screen.getByText('common.operation.add'))

    const expandButton = screen.getByText('app.accessControlDialog.operateGroupAndMember.expand')
    await user.click(expandButton)
    expect(useAccessControlStore.getState().selectedGroupsForBreadcrumb).toEqual([baseGroup])

    const memberLabel = screen.getByText(baseMember.name)
    const memberCheckbox = memberLabel.parentElement?.previousElementSibling as HTMLElement
    fireEvent.click(memberCheckbox)

    expect(useAccessControlStore.getState().specificMembers).toEqual([baseMember])
  })

  it('should show empty state when no candidates are returned', async () => {
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

// AccessControl integrates dialog, selection items, and confirm flow
describe('AccessControl', () => {
  it('should initialize menu from app and call update on confirm', async () => {
    const onClose = vi.fn()
    const onConfirm = vi.fn()
    const toastSpy = vi.spyOn(Toast, 'notify').mockReturnValue({})
    useAccessControlStore.setState({
      specificGroups: [baseGroup],
      specificMembers: [baseMember],
    })
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

    await waitFor(() => {
      expect(useAccessControlStore.getState().currentMenu).toBe(AccessMode.SPECIFIC_GROUPS_MEMBERS)
    })

    fireEvent.click(screen.getByText('common.operation.confirm'))

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        appId: app.id,
        accessMode: AccessMode.SPECIFIC_GROUPS_MEMBERS,
        subjects: [
          { subjectId: baseGroup.id, subjectType: SubjectType.GROUP },
          { subjectId: baseMember.id, subjectType: SubjectType.ACCOUNT },
        ],
      })
      expect(toastSpy).toHaveBeenCalled()
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
