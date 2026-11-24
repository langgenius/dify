import type { WorkflowCommentBasic } from '@dify/contracts/api/console/apps/types.gen'
import type { ReactElement } from 'react'
import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedMentionableUsers } from './__tests__/comment-query-data'
import { CommentMarkerFixture } from './__tests__/comment-thread-fixture'

const render = (ui: ReactElement, userId = 'user-1') => {
  const { queryClient } = createConsoleQueryWrapper({
    accountProfile: { id: userId, name: 'User', avatar_url: 'avatar' },
  })
  seedMentionableUsers(queryClient, [])
  return renderWorkflowFlowComponent(ui, {
    queryClient,
    resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    reactFlowProps: {
      proOptions: { hideAttribution: true },
      fitView: false,
      defaultViewport: { x: 50, y: 30, zoom: 2 },
    },
  })
}

const createComment = (overrides: Partial<WorkflowCommentBasic> = {}): WorkflowCommentBasic => ({
  id: 'comment-1',
  position_x: 0,
  position_y: 0,
  content: 'Hello',
  created_by: 'user-1',
  created_by_account: {
    id: 'user-1',
    name: 'Alice',
    email: 'alice@example.com',
    avatar_url: null,
  },
  created_at: 1,
  updated_at: 2,
  resolved: false,
  mention_count: 0,
  reply_count: 0,
  participants: [],
  ...overrides,
})

describe('CommentIcon', () => {
  it('opens with the keyboard and moves an authored comment in canvas coordinates', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    const onPositionUpdate = vi.fn()
    function Comment() {
      const [comment, setComment] = useState(() => createComment())
      return (
        <CommentMarkerFixture
          comment={comment}
          onOpen={onClick}
          onPositionUpdate={(_commentId, position) => {
            onPositionUpdate(position)
            setComment((current) => ({
              ...current,
              position_x: position.x,
              position_y: position.y,
            }))
          }}
        />
      )
    }
    render(<Comment />)
    await user.tab()
    const marker = screen.getByRole('button', { name: /workflow.keyboard.openComment/ })
    expect(marker).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(onClick).toHaveBeenCalledTimes(1)
    await user.keyboard('{ArrowRight}{Shift>}{ArrowDown}{/Shift}')
    expect(onPositionUpdate).toHaveBeenLastCalledWith({ x: 5, y: 20 })
    expect(marker).toHaveFocus()
    onPositionUpdate.mockClear()
    await user.keyboard('{ArrowRight>3}')
    expect(onPositionUpdate).not.toHaveBeenCalled()
    await user.keyboard('{/ArrowRight}')
    expect(onPositionUpdate).toHaveBeenCalledExactlyOnceWith({ x: 20, y: 20 })
  })

  it("allows opening another author's comment but does not move it with arrow keys", async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    const onPositionUpdate = vi.fn()
    render(
      <CommentMarkerFixture
        comment={createComment()}
        onOpen={onClick}
        onPositionUpdate={onPositionUpdate}
      />,
      'user-2',
    )
    await user.tab()
    await user.keyboard('{ArrowRight}{Enter}')
    expect(onPositionUpdate).not.toHaveBeenCalled()
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('converts pointer movement through the zoomed canvas before saving the authored position', () => {
    const comment = createComment({ position_x: 0, position_y: 0 })
    const onClick = vi.fn()
    const onPositionUpdate = vi.fn()
    render(
      <CommentMarkerFixture
        comment={comment}
        onOpen={onClick}
        onPositionUpdate={onPositionUpdate}
      />,
    )
    const marker = screen.getByRole('button', { name: /workflow.keyboard.openComment/ })

    fireEvent.pointerDown(marker, {
      pointerId: 1,
      button: 0,
      clientX: 100,
      clientY: 100,
    })
    fireEvent.pointerMove(marker, {
      pointerId: 1,
      clientX: 110,
      clientY: 110,
    })
    fireEvent.pointerUp(marker, {
      pointerId: 1,
      clientX: 110,
      clientY: 110,
    })

    fireEvent.click(marker)

    expect(onPositionUpdate).toHaveBeenCalledExactlyOnceWith(expect.any(String), { x: 5, y: 5 })
    expect(onClick).not.toHaveBeenCalled()
  })

  it('opens another author’s comment with a click', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <CommentMarkerFixture comment={createComment()} onOpen={onClick} isActive={false} />,
      'user-2',
    )

    await user.click(screen.getByRole('button', { name: /workflow.keyboard.openComment/ }))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('still opens from the keyboard after the preview card was dragged', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    render(
      <CommentMarkerFixture comment={createComment()} onOpen={onOpen} onPositionUpdate={vi.fn()} />,
    )
    const marker = screen.getByRole('button', { name: /workflow.keyboard.openComment/ })
    await user.hover(within(marker).getByRole('img', { name: 'Alice' }))
    const preview = screen.getByText('Hello').closest('[data-role="comment-preview"]')!

    fireEvent.pointerDown(preview, { pointerId: 1, button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(preview, { pointerId: 1, clientX: 120, clientY: 120 })
    fireEvent.pointerUp(preview, { pointerId: 1, clientX: 120, clientY: 120 })
    expect(onOpen).not.toHaveBeenCalled()

    marker.focus()
    await user.keyboard('{Enter}')
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})
