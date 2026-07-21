import type { FC } from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@/test/console/render'
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

vi.mock('react-i18next', async () => {
  const { withSelectorKey } = await import('@/test/i18n-mock')
  return {
    useTranslation: () => ({
      t: withSelectorKey(stableT),
    }),
  }
})

vi.mock('@/context/account-state', async () => {
  const { createAccountStateModuleMock } = await import('@/test/console/state-fixture')
  return createAccountStateModuleMock(() => mockConsoleState)
})

vi.mock('@langgenius/dify-ui/avatar', () => ({
  Avatar: ({ name }: { name: string }) => <div data-testid="avatar">{name}</div>,
  default: ({ name }: { name: string }) => <div data-testid="avatar">{name}</div>,
}))

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
