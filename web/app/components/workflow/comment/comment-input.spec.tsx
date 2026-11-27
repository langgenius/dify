import type { ReactElement } from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ReactFlowProvider } from 'reactflow'
import { describe, expect, it, vi } from 'vite-plus/test'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { createConsoleQueryClient } from '@/test/console/query-data'
import { renderWorkflowComponent } from '../__tests__/workflow-test-env'
import { seedMentionableUsers } from './__tests__/comment-query-data'
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
  seedMentionableUsers(queryClient, [
    { id: 'user-2', name: 'Bob', email: 'bob@example.com', avatar_url: '' },
  ])
  return renderWorkflowComponent(<ReactFlowProvider>{ui}</ReactFlowProvider>, {
    resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    queryClient,
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
          position={position}
          onCancel={vi.fn()}
          onSubmit={vi.fn()}
          onPositionChange={(next) => {
            onPositionChange(next)
            setPosition(next)
          }}
        />
      )
    }
    render(<Draft />)
    const handle = screen.getByRole('button', { name: 'workflow.keyboard.moveDraftComment' })
    // The input takes focus as the draft opens.
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveFocus())
    handle.focus()
    await user.keyboard('{Enter}{ArrowRight}{Shift>}{ArrowDown}{/Shift}')
    expect(onPositionChange).toHaveBeenLastCalledWith({ x: 105, y: 120 })
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

  it('submits the text with the people it mentions', async () => {
    const onSubmit = vi.fn()
    render(<CommentInput position={{ x: 0, y: 0 }} onSubmit={onSubmit} onCancel={vi.fn()} />)

    const user = userEvent.setup()
    await user.type(screen.getByRole('textbox'), '@Bo')
    await user.click(await screen.findByText('bob@example.com'))
    await user.type(screen.getByRole('textbox'), 'Hello')
    await user.click(screen.getByRole('button', { name: 'common.operation.send' }))

    expect(onSubmit).toHaveBeenCalledWith('@Bob Hello', ['user-2'])
  })

  it('keeps its text read-only while the comment is created', () => {
    render(
      <CommentInput position={{ x: 0, y: 0 }} onSubmit={vi.fn()} onCancel={vi.fn()} submitting />,
    )

    const textbox = screen.getByRole('textbox')
    expect(textbox).toHaveAttribute('readonly')
    expect(textbox).toHaveAttribute('aria-busy', 'true')
  })

  it('keeps the text to send again when creating the comment fails', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('Request failed'))

    render(<CommentInput position={{ x: 0, y: 0 }} onSubmit={onSubmit} onCancel={vi.fn()} />)

    const user = userEvent.setup()
    await user.type(screen.getByRole('textbox'), 'Hello')
    await user.click(screen.getByRole('button', { name: 'common.operation.send' }))

    const textbox = screen.getByRole('textbox')
    expect(textbox).toHaveValue('Hello')
    expect(textbox).not.toHaveAttribute('readonly')
  })
})
