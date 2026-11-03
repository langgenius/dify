import type { WorkflowCommentBasic } from '@dify/contracts/api/console/apps/types.gen'
import type { ReactElement } from 'react'
import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { CommentIcon } from './comment-icon'

const render = (ui: ReactElement, userId = 'user-1') => {
  const { queryClient } = createConsoleQueryWrapper({
    accountProfile: { id: userId, name: 'User', avatar_url: 'avatar' },
  })
  return renderWorkflowFlowComponent(ui, {
    queryClient,
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
        <CommentIcon
          comment={comment}
          onClick={onClick}
          onPositionUpdate={(position) => {
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
      <CommentIcon
        comment={createComment()}
        onClick={onClick}
        onPositionUpdate={onPositionUpdate}
      />,
      'user-2',
    )
    await user.tab()
    await user.keyboard('{ArrowRight}{Enter}')
    expect(onPositionUpdate).not.toHaveBeenCalled()
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('toggles preview on hover when inactive', async () => {
    const user = userEvent.setup()
    const comment = createComment()
    render(<CommentIcon comment={comment} onClick={vi.fn()} isActive={false} />)
    const marker = screen.getByRole('button', { name: /workflow.keyboard.openComment/ })
    await user.hover(within(marker).getByRole('img', { name: 'Alice' }))
    expect(screen.getByText('Hello')).toBeInTheDocument()

    await user.unhover(within(marker).getByRole('img', { name: 'Alice' }))
    expect(screen.queryByText('Hello')).not.toBeInTheDocument()
  })

  it('converts pointer movement through the zoomed canvas before saving the authored position', () => {
    const comment = createComment({ position_x: 0, position_y: 0 })
    const onClick = vi.fn()
    const onPositionUpdate = vi.fn()
    render(<CommentIcon comment={comment} onClick={onClick} onPositionUpdate={onPositionUpdate} />)
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

    expect(onPositionUpdate).toHaveBeenCalledExactlyOnceWith({ x: 5, y: 5 })
    expect(onClick).not.toHaveBeenCalled()
  })

  it('opens another author’s comment with a click', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<CommentIcon comment={createComment()} onClick={onClick} isActive={false} />, 'user-2')

    await user.click(screen.getByRole('button', { name: /workflow.keyboard.openComment/ }))

    expect(onClick).toHaveBeenCalledExactlyOnceWith()
  })
})
