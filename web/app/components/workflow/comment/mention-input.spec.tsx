import type { UserProfile } from '@/service/workflow-comment'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { MentionInput } from './mention-input'

const mockFetchMentionableUsers = vi.hoisted(() => vi.fn())
const mockSetMentionableUsersLoading = vi.hoisted(() => vi.fn())
const mockSetMentionableUsersCache = vi.hoisted(() => vi.fn())

const mentionStoreState = vi.hoisted(() => ({
  mentionableUsersCache: {} as Record<string, UserProfile[]>,
  mentionableUsersLoading: {} as Record<string, boolean>,
  setMentionableUsersLoading: (appId: string, loading: boolean) => {
    mockSetMentionableUsersLoading(appId, loading)
    mentionStoreState.mentionableUsersLoading[appId] = loading
  },
  setMentionableUsersCache: (appId: string, users: UserProfile[]) => {
    mockSetMentionableUsersCache(appId, users)
    mentionStoreState.mentionableUsersCache[appId] = users
  },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { ns?: string }) => options?.ns ? `${options.ns}.${key}` : key,
  }),
}))

vi.mock('@/next/navigation', () => ({
  useParams: () => ({ appId: 'app-1' }),
}))

vi.mock('@/service/workflow-comment', () => ({
  fetchMentionableUsers: (...args: unknown[]) => mockFetchMentionableUsers(...args),
}))

vi.mock('../store', () => ({
  useStore: (selector: (state: typeof mentionStoreState) => unknown) => selector(mentionStoreState),
  useWorkflowStore: () => ({
    getState: () => mentionStoreState,
  }),
}))

vi.mock('@/app/components/base/ui/avatar', () => ({
  Avatar: ({ name }: { name: string }) => <div data-testid="mention-avatar">{name}</div>,
}))

const mentionUsers: UserProfile[] = [
  {
    id: 'user-2',
    name: 'Alice',
    email: 'alice@example.com',
    avatar_url: 'alice.png',
  },
  {
    id: 'user-3',
    name: 'Bob',
    email: 'bob@example.com',
    avatar_url: 'bob.png',
  },
]

function ControlledMentionInput({
  onSubmit,
}: {
  onSubmit: (content: string, mentionedUserIds: string[]) => void
}) {
  const [value, setValue] = useState('')
  return (
    <MentionInput
      value={value}
      onChange={setValue}
      onSubmit={onSubmit}
    />
  )
}

describe('MentionInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mentionStoreState.mentionableUsersCache = {}
    mentionStoreState.mentionableUsersLoading = {}
    mockFetchMentionableUsers.mockResolvedValue(mentionUsers)
  })

  it('loads mentionable users when cache is empty', async () => {
    render(
      <MentionInput
        value=""
        onChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(mockFetchMentionableUsers).toHaveBeenCalledWith('app-1')
    })

    expect(mockSetMentionableUsersLoading).toHaveBeenCalledWith('app-1', true)
    expect(mockSetMentionableUsersCache).toHaveBeenCalledWith('app-1', mentionUsers)
    expect(mockSetMentionableUsersLoading).toHaveBeenCalledWith('app-1', false)
  })

  it('selects a mention and submits with mentioned user ids', async () => {
    mentionStoreState.mentionableUsersCache['app-1'] = mentionUsers
    const onSubmit = vi.fn()

    render(<ControlledMentionInput onSubmit={onSubmit} />)

    const textarea = screen.getByPlaceholderText('workflow.comments.placeholder.add') as HTMLTextAreaElement
    textarea.focus()
    textarea.setSelectionRange(4, 4)
    fireEvent.change(textarea, { target: { value: '@Ali' } })

    await waitFor(() => {
      expect(screen.getByText('alice@example.com')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('alice@example.com'))
    fireEvent.change(textarea, { target: { value: '@Alice hi' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('@Alice hi', ['user-2'])
    })
  })

  it('supports editing mode cancel and save actions', async () => {
    mentionStoreState.mentionableUsersCache['app-1'] = mentionUsers
    const onSubmit = vi.fn()
    const onCancel = vi.fn()

    render(
      <MentionInput
        value="  updated reply  "
        onChange={vi.fn()}
        onSubmit={onSubmit}
        onCancel={onCancel}
        isEditing
      />,
    )

    fireEvent.click(screen.getByText('common.operation.cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByText('common.operation.save'))
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('updated reply', [])
    })
  })
})
