import type { AccessControlAccount, Subject } from '@/models/access-control'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SubjectType } from '@/models/access-control'
import { AccessSubjectAddButton } from '../add-button'

const mockUseSearchAccessSubjects = vi.hoisted(() => vi.fn())

vi.mock('@/context/account-state', async () => {
  const { atom } = await import('jotai')

  return {
    userProfileAtom: atom({ email: 'current@example.com' }),
  }
})

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

const member: AccessControlAccount = {
  id: 'account-1',
  name: 'Member One',
  email: 'member@example.com',
  avatar: '',
  avatarUrl: '',
}

const memberSubject: Subject = {
  subjectId: member.id,
  subjectType: SubjectType.ACCOUNT,
  accountData: member,
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
            subjects: [groupSubject, memberSubject],
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

  it('should keep group and member selected state in sync with checkbox icon DOM', async () => {
    const user = userEvent.setup()
    const group = groupSubject.groupData
    const onChange = vi.fn()
    const { rerender } = render(
      <AccessSubjectAddButton selectedGroups={[group]} selectedMembers={[]} onChange={onChange} />,
    )

    await user.click(screen.getByRole('combobox', { name: 'common.operation.add' }))

    const groupOption = await screen.findByRole('option', { name: /Group One/ })
    const memberOption = screen.getByRole('option', { name: /Member One/ })
    const expandButton = screen.getByRole('button', {
      name: 'app.accessControlDialog.operateGroupAndMember.expand',
    })
    expect(groupOption).toHaveClass('mx-0', 'pl-2')
    expect(memberOption).toHaveClass('mx-0', 'pl-2', 'pr-3')
    expect(groupOption).toHaveAttribute('data-selected')
    expect(groupOption.querySelector('.i-ri-check-line')).toBeInTheDocument()
    expect(memberOption).not.toHaveAttribute('data-selected')
    expect(memberOption.querySelector('.i-ri-check-line')).not.toBeInTheDocument()
    expect(expandButton).toBeDisabled()

    rerender(
      <AccessSubjectAddButton selectedGroups={[]} selectedMembers={[member]} onChange={onChange} />,
    )

    await waitFor(() => {
      expect(groupOption).not.toHaveAttribute('data-selected')
      expect(groupOption.querySelector('.i-ri-check-line')).not.toBeInTheDocument()
      expect(memberOption).toHaveAttribute('data-selected')
      expect(memberOption.querySelector('.i-ri-check-line')).toBeInTheDocument()
      expect(expandButton).not.toBeDisabled()
    })
  })
})
