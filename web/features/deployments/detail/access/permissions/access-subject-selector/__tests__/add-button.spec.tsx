import type { Subject } from '@/models/access-control'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SubjectType } from '@/models/access-control'
import { AccessSubjectAddButton } from '../add-button'

const mockUseSearchAccessSubjects = vi.hoisted(() => vi.fn())

vi.mock('@/service/access-control/use-access-subjects', () => ({
  useSearchAccessSubjects: (...args: unknown[]) => mockUseSearchAccessSubjects(...args),
}))

const groupSubject: Subject = {
  subjectId: 'group-1',
  subjectType: SubjectType.GROUP,
  groupData: {
    id: 'group-1',
    name: 'Group One',
    groupSize: 2,
  },
}

function lastSearchParams() {
  return mockUseSearchAccessSubjects.mock.calls.at(-1)?.[0] as { groupId?: string } | undefined
}

// The add menu owns transient browsing state; reopening should start from the root group list.
describe('AccessSubjectAddButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseSearchAccessSubjects.mockReturnValue({
      data: {
        pages: [
          {
            subjects: [groupSubject],
            hasMore: false,
          },
        ],
      },
      fetchNextPage: vi.fn(),
      isFetchingNextPage: false,
      isLoading: false,
    })
  })

  it('should reset expanded group browsing when the add menu reopens', async () => {
    const user = userEvent.setup()

    render(<AccessSubjectAddButton selectedGroups={[]} selectedMembers={[]} onChange={vi.fn()} />)

    const addButton = screen.getByRole('combobox', { name: 'common.operation.add' })

    await user.click(addButton)
    await user.click(
      await screen.findByRole('button', {
        name: 'app.accessControlDialog.operateGroupAndMember.expand',
      }),
    )

    await waitFor(() => {
      expect(lastSearchParams()).toMatchObject({ groupId: 'group-1' })
    })

    await user.click(addButton)
    await waitFor(() => {
      expect(addButton).toHaveAttribute('aria-expanded', 'false')
    })

    await user.click(addButton)

    await waitFor(() => {
      expect(lastSearchParams()?.groupId).toBeUndefined()
    })
  })
})
