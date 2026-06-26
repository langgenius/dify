import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AccessMode } from '@/models/access-control'
import { DeploymentAccessControlDialog } from '../deployment-access-control-dialog'

const mockUseSearchAccessSubjects = vi.hoisted(() => vi.fn())

vi.mock('@/service/access-control/use-access-subjects', () => ({
  useSearchAccessSubjects: (...args: unknown[]) => mockUseSearchAccessSubjects(...args),
}))

describe('DeploymentAccessControlDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseSearchAccessSubjects.mockReturnValue({
      data: { pages: [] },
      fetchNextPage: vi.fn(),
      isFetchingNextPage: false,
      isLoading: false,
    })
  })

  it('should submit the selected deployment access subjects', () => {
    const handleSubmit = vi.fn()

    render(
      <DeploymentAccessControlDialog
        initialDraft={{
          currentMenu: AccessMode.SPECIFIC_GROUPS_MEMBERS,
          specificGroups: [{ id: 'group-1', name: 'Group One', groupSize: 2 }],
          specificMembers: [{ id: 'member-1', name: 'Member One', email: 'member@example.com', avatar: '', avatarUrl: '' }],
          selectedGroupsForBreadcrumb: [],
        }}
        onClose={vi.fn()}
        onSubmit={handleSubmit}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

    expect(handleSubmit).toHaveBeenCalledWith('specific', {
      groups: [{ id: 'group-1', name: 'Group One', groupSize: 2 }],
      members: [{ id: 'member-1', name: 'Member One', email: 'member@example.com', avatar: '', avatarUrl: '' }],
    })
  })
})
