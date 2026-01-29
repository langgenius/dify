import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ControlMode } from '../types'
import { CommentCursor } from './cursor'

const mockState = {
  controlMode: ControlMode.Pointer,
  isCommentPlacing: false,
  mousePosition: {
    elementX: 10,
    elementY: 20,
  },
}

vi.mock('@/app/components/base/icons/src/public/other', () => ({
  Comment: (props: { className?: string }) => <svg data-testid="comment-icon" {...props} />,
}))

vi.mock('../store', () => ({
  useStore: (selector: (state: typeof mockState) => unknown) => selector(mockState),
}))

describe('CommentCursor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when not in comment mode', () => {
    mockState.controlMode = ControlMode.Pointer

    render(<CommentCursor />)

    expect(screen.queryByTestId('comment-icon')).not.toBeInTheDocument()
  })

  it('renders at current mouse position when in comment mode', () => {
    mockState.controlMode = ControlMode.Comment

    render(<CommentCursor />)

    const icon = screen.getByTestId('comment-icon')
    const container = icon.parentElement as HTMLElement

    expect(container).toHaveStyle({ left: '10px', top: '20px' })
  })
})
