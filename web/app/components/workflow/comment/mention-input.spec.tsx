import type { ReactElement } from 'react'
import type { UserProfile } from '@/app/components/workflow/comment/types'
import { act, render as renderComponent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { WorkflowContext } from '../context'
import { EditorResourceScope } from '../editor-resource/provider'
import { createWorkflowStore } from '../store'
import { MentionInput } from './mention-input'

const render = (ui: ReactElement, cachedUsers?: UserProfile[]) => {
  const store = createWorkflowStore({})
  if (cachedUsers) store.getState().setMentionableUsersCache('app-1', cachedUsers)
  return renderComponent(
    <EditorResourceScope resource={{ kind: 'app', appId: 'app-1', mode: 'workflow' }}>
      <WorkflowContext value={store}>{ui}</WorkflowContext>
    </EditorResourceScope>,
  )
}
const mockFetchMentionableUsers = vi.hoisted(() => vi.fn())

vi.mock('@/service/console', () => ({
  consoleClient: {
    apps: {
      byAppId: {
        workflow: {
          comments: {
            mentionUsers: {
              get: (...args: unknown[]) => mockFetchMentionableUsers(...args),
            },
          },
        },
      },
    },
  },
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
  return <MentionInput value={value} onChange={setValue} onSubmit={onSubmit} />
}

describe('MentionInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchMentionableUsers.mockResolvedValue({ users: mentionUsers })
  })

  it('loads users, selects a mention and submits its user id through the real store', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()

    render(<ControlledMentionInput onSubmit={onSubmit} />)

    const textarea = screen.getByPlaceholderText(
      'workflowComments.comments.placeholder.add',
    ) as HTMLTextAreaElement
    await user.type(textarea, '@Ali')

    await waitFor(() => {
      expect(screen.getByText('alice@example.com')).toBeInTheDocument()
    })

    expect(mockFetchMentionableUsers).toHaveBeenCalledExactlyOnceWith({
      params: { app_id: 'app-1' },
    })
    await user.click(screen.getByText('alice@example.com'))
    await waitFor(() => expect(textarea).toHaveFocus())
    await user.type(textarea, 'hi')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('@Alice hi', ['user-2'])
    })
  })

  it('uses cached users and trims the saved reply in editing mode', async () => {
    const user = userEvent.setup()
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
      mentionUsers,
    )
    expect(mockFetchMentionableUsers).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('updated reply', [])
    })
  })

  it('focuses the textarea at the end when autoFocus is enabled', () => {
    vi.useFakeTimers()
    try {
      const { unmount } = render(
        <MentionInput value="draft" onChange={vi.fn()} onSubmit={vi.fn()} autoFocus />,
        mentionUsers,
      )

      const textarea = screen.getByPlaceholderText(
        'workflowComments.comments.placeholder.add',
      ) as HTMLTextAreaElement

      act(() => {
        vi.runOnlyPendingTimers()
      })

      expect(document.activeElement).toBe(textarea)
      expect(textarea.selectionStart).toBe(5)
      expect(textarea.selectionEnd).toBe(5)

      unmount()
    } finally {
      vi.useRealTimers()
    }
  })
})
