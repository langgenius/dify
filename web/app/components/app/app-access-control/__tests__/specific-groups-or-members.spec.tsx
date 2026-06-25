import type { AccessControlAccount, AccessControlGroup } from '@/models/access-control'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AccessMode } from '@/models/access-control'
import { SpecificGroupsOrMembers } from '../specific-groups-or-members'
import { createAccessControlDraftHarness } from './access-control-test-utils'

const mockUseSearchForWhiteListCandidates = vi.fn()

vi.mock('@/service/access-control', () => ({
  useSearchForWhiteListCandidates: (...args: unknown[]) => mockUseSearchForWhiteListCandidates(...args),
}))

vi.mock('@/service/access-control/use-app-access-control', () => ({
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

describe('SpecificGroupsOrMembers', () => {
  const baseGroup = createGroup()
  const baseMember = createMember()

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseSearchForWhiteListCandidates.mockReturnValue({
      isLoading: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      data: { pages: [] },
    })
  })

  it('should render the collapsed row when not in specific mode', () => {
    const harness = createAccessControlDraftHarness(
      <SpecificGroupsOrMembers />,
      { currentMenu: AccessMode.ORGANIZATION },
    )

    render(harness.element)

    expect(screen.getByText('app.accessControlDialog.accessItems.specific')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.operation.add' })).not.toBeInTheDocument()
  })

  it('should show loading when the selected subjects are pending', async () => {
    const harness = createAccessControlDraftHarness(<SpecificGroupsOrMembers loading />)
    render(harness.element)

    expect(screen.getByRole('combobox', { name: 'common.operation.add' })).toBeDisabled()

    await waitFor(() => {
      expect(screen.getByRole('status', { name: 'common.loading' })).toBeInTheDocument()
    })
  })

  it('should render fetched groups and members and support removal', async () => {
    const harness = createAccessControlDraftHarness(
      <SpecificGroupsOrMembers />,
      {
        appId: 'app-1',
        specificGroups: [baseGroup],
        specificMembers: [baseMember],
      },
    )

    render(harness.element)

    await waitFor(() => {
      expect(screen.getByText(baseGroup.name)).toBeInTheDocument()
      expect(screen.getByText(baseMember.name)).toBeInTheDocument()
    })

    const removeButtons = screen.getAllByRole('button', { name: /operation\.remove$/ })
    const groupRemove = removeButtons[0]!
    const memberRemove = removeButtons[1]!

    fireEvent.click(groupRemove)
    expect(harness.getSnapshot().specificGroups).toEqual([])

    fireEvent.click(memberRemove)
    expect(harness.getSnapshot().specificMembers).toEqual([])
  })
})
