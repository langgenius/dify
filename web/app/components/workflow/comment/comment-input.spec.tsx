import type { ReactElement } from 'react'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { createAccountProfileQueryWrapper } from '@/test/console/account-profile'
import { render as renderWithConsoleState } from '@/test/console/render'
import { CommentInput } from './comment-input'

type MentionInputProps = {
  value: string
  onChange: (value: string) => void
  onSubmit: (content: string, mentionedUserIds: string[]) => void
  placeholder?: string
  disabled?: boolean
  autoFocus?: boolean
  className?: string
}

const mockConsoleState = vi.hoisted(() => ({
  userProfile: {
    id: 'user-1',
    name: 'Alice',
    avatar_url: 'avatar',
  },
}))

const render = (ui: ReactElement) =>
  renderWithConsoleState(ui, {
    wrapper: createAccountProfileQueryWrapper(mockConsoleState.userProfile),
  })

// Mention parsing is independently tested; retain the owner's controlled draft and reset behavior.
vi.mock('./mention-input', () => ({
  MentionInput: (props: MentionInputProps) => (
    <>
      <textarea
        aria-label="Comment draft"
        value={props.value}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.value)}
      />
      <button
        type="button"
        disabled={props.disabled}
        onClick={() => props.onSubmit(props.value, ['user-2'])}
      >
        Submit mention
      </button>
    </>
  ),
}))

describe('CommentInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

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
            setPosition({ x: next.elementX, y: next.elementY })
          }}
        />
      )
    }
    render(<Draft />)
    await user.tab()
    const handle = screen.getByRole('button', { name: 'workflow.keyboard.moveDraftComment' })
    await user.keyboard('{Enter}{ArrowRight}{Shift>}{ArrowDown}{/Shift}')
    expect(onPositionChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ elementX: 105, elementY: 120 }),
    )
    expect(handle).toHaveAttribute('aria-pressed', 'true')
    await user.keyboard('{Enter}{ArrowRight}')
    expect(handle).toHaveAttribute('aria-pressed', 'false')
    expect(onPositionChange).toHaveBeenCalledTimes(2)
    await user.tab()
    expect(screen.getByRole('textbox', { name: 'Comment draft' })).toHaveFocus()
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
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Comment draft' }), { key: 'Escape' })

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('submits the draft and clears it after the mention editor reports submission', async () => {
    const onSubmit = vi.fn()

    render(<CommentInput position={{ x: 0, y: 0 }} onSubmit={onSubmit} onCancel={vi.fn()} />)

    const user = userEvent.setup()
    await user.type(screen.getByRole('textbox', { name: 'Comment draft' }), 'Hello')
    await user.click(screen.getByRole('button', { name: 'Submit mention' }))

    expect(onSubmit).toHaveBeenCalledWith('Hello', ['user-2'])
    expect(screen.getByRole('textbox', { name: 'Comment draft' })).toHaveValue('')
  })
})
