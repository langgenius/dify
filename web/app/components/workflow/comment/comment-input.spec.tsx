import type { FC } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommentInput } from './comment-input'

type MentionInputProps = {
  value: string
  onChange: (value: string) => void
  onSubmit: (content: string, mentionedUserIds: string[]) => void
  placeholder?: string
  autoFocus?: boolean
  disabled?: boolean
  className?: string
}

const stableT = (key: string, options?: { ns?: string }) => (
  options?.ns ? `${options.ns}.${key}` : key
)

let mentionInputProps: MentionInputProps | null = null

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: stableT,
  }),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    userProfile: {
      id: 'user-1',
      name: 'Alice',
      avatar_url: 'avatar',
    },
  }),
}))

vi.mock('@/app/components/base/avatar', () => ({
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
    render(
      <CommentInput
        position={{ x: 0, y: 0 }}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(mentionInputProps?.placeholder).toBe('workflow.comments.placeholder.add')
    expect(mentionInputProps?.autoFocus).toBe(true)
  })

  it('calls onCancel when Escape is pressed', () => {
    const onCancel = vi.fn()

    render(
      <CommentInput
        position={{ x: 0, y: 0 }}
        onSubmit={vi.fn()}
        onCancel={onCancel}
      />,
    )

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('forwards mention submit to onSubmit', () => {
    const onSubmit = vi.fn()

    render(
      <CommentInput
        position={{ x: 0, y: 0 }}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByTestId('mention-input'))

    expect(onSubmit).toHaveBeenCalledWith('Hello', ['user-2'])
  })
})
