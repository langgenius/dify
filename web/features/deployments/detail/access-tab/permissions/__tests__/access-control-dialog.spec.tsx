import { AccessSubjectType } from '@dify/contracts/enterprise/types.gen'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DeploymentAccessControlDialog } from '../access-control-dialog'

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
        open
        resetKey={1}
        initialKind="specific"
        initialSubjects={[
          {
            id: 'group-1',
            subjectType: AccessSubjectType.ACCESS_SUBJECT_TYPE_GROUP,
            name: 'Group One',
            memberCount: 2,
          },
          {
            id: 'member-1',
            subjectType: AccessSubjectType.ACCESS_SUBJECT_TYPE_ACCOUNT,
            name: 'Member One',
          },
        ]}
        onClose={vi.fn()}
        onSubmit={handleSubmit}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

    expect(handleSubmit).toHaveBeenCalledWith('specific', [
      {
        id: 'group-1',
        subjectType: AccessSubjectType.ACCESS_SUBJECT_TYPE_GROUP,
        name: 'Group One',
        memberCount: 2,
      },
      {
        id: 'member-1',
        subjectType: AccessSubjectType.ACCESS_SUBJECT_TYPE_ACCOUNT,
        name: 'Member One',
      },
    ])
  })
})
