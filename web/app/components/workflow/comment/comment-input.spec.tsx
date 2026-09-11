import type { FC, ReactElement } from 'react'
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

const stableT = (key: string, options?: { ns?: string }) =>
  options?.ns ? `${options.ns}.${key}` : key

let mentionInputProps: MentionInputProps | null = null
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

vi.mock('react-i18next', async () => {
  const { withSelectorKey } = await import('@/test/i18n-mock')
  return {
    useTranslation: () => ({
      t: withSelectorKey(stableT),
    }),
  }
})

vi.mock('./mention-input', () => ({
  MentionInput: ((props: MentionInputProps) => {
    mentionInputProps = props
    return (
      <button
        type="button"
        data-testid="mention-input"
        onClick={() => props.onSubmit('Hello', ['user-2'])}
      >
        MentionInput
      </button>
    )
  }) as FC<MentionInputProps>,
}))

describe('CommentInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mentionInputProps = null
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
    expect(screen.getByTestId('mention-input')).toHaveFocus()
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

  it('passes translated placeholder to mention input', () => {
    render(<CommentInput position={{ x: 0, y: 0 }} onSubmit={vi.fn()} onCancel={vi.fn()} />)

    expect(mentionInputProps?.placeholder).toBe('workflow.comments.placeholder.add')
    expect(mentionInputProps?.autoFocus).toBe(true)
    expect(mentionInputProps?.disabled).toBe(false)
  })

  it('calls onCancel when Escape is pressed', () => {
    const onCancel = vi.fn()

    render(<CommentInput position={{ x: 0, y: 0 }} onSubmit={vi.fn()} onCancel={onCancel} />)

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('forwards mention submit to onSubmit', () => {
    const onSubmit = vi.fn()

    render(<CommentInput position={{ x: 0, y: 0 }} onSubmit={onSubmit} onCancel={vi.fn()} />)

    fireEvent.click(screen.getByTestId('mention-input'))

    expect(onSubmit).toHaveBeenCalledWith('Hello', ['user-2'])
  })
})
