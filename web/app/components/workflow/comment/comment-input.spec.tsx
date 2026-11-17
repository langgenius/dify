import type { ReactElement } from 'react'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { createConsoleQueryClient } from '@/test/console/query-data'
import { renderWorkflowComponent } from '../__tests__/workflow-test-env'
import { CommentInput } from './comment-input'

const mockConsoleState = vi.hoisted(() => ({
  userProfile: {
    id: 'user-1',
    name: 'Alice',
    avatar_url: 'avatar',
  },
}))

const render = (ui: ReactElement) => {
  const queryClient = createConsoleQueryClient()
  seedAccountProfileQuery(queryClient, mockConsoleState.userProfile)
  return renderWorkflowComponent(ui, {
    resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    queryClient,
    initialStoreState: {
      mentionableUsersCache: {
        'app-1': [{ id: 'user-2', name: 'Bob', email: 'bob@example.com', avatar_url: '' }],
      },
    },
  })
}

describe('CommentInput', () => {
  it('moves the draft using a focused handle and finishes moving with Enter', async () => {
    const user = userEvent.setup()
    const onPositionChange = vi.fn()
    function Draft() {
      const [position, setPosition] = useState({ x: 100, y: 100 })
      return (
        <CommentInput
          autoFocus={false}
          position={position}
          onCancel={vi.fn()}
          onSubmit={vi.fn()}
          onPositionChange={(next) => {
            onPositionChange(next)
            setPosition({ x: next.elementX, y: next.elementY })
          }}
        />
      )
    }
    render(<Draft />)
    const handle = screen.getByRole('button', { name: 'workflow.keyboard.moveDraftComment' })
    handle.focus()
    await user.keyboard('{Enter}{ArrowRight}{Shift>}{ArrowDown}{/Shift}')
    expect(onPositionChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ elementX: 105, elementY: 120 }),
    )
    expect(handle).toHaveAttribute('aria-pressed', 'true')
    await user.keyboard('{Enter}{ArrowRight}')
    expect(handle).toHaveAttribute('aria-pressed', 'false')
    expect(onPositionChange).toHaveBeenCalledTimes(2)
    await user.tab()
    expect(screen.getByRole('textbox')).toHaveFocus()
  })

  it('does not offer keyboard movement while disabled', () => {
    render(
      <CommentInput
        position={{ x: 0, y: 0 }}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
        onPositionChange={vi.fn()}
        disabled
      />,
    )
    expect(
      screen.getByRole('button', { name: 'workflow.keyboard.moveDraftComment' }),
    ).toBeDisabled()
  })

  it('calls onCancel when Escape is pressed', () => {
    const onCancel = vi.fn()

    render(<CommentInput position={{ x: 0, y: 0 }} onSubmit={vi.fn()} onCancel={onCancel} />)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('submits the real mention and clears the draft', async () => {
    const onSubmit = vi.fn()

    render(<CommentInput position={{ x: 0, y: 0 }} onSubmit={onSubmit} onCancel={vi.fn()} />)

    const user = userEvent.setup()
    await user.type(screen.getByRole('textbox'), '@Bo')
    await user.click(await screen.findByText('bob@example.com'))
    await user.type(screen.getByRole('textbox'), 'Hello')
    await user.click(screen.getByRole('button', { name: 'common.operation.send' }))

    expect(onSubmit).toHaveBeenCalledWith('@Bob Hello', ['user-2'])
    expect(screen.getByRole('textbox')).toHaveValue('')
  })
})
