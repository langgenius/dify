import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { ControlMode } from '../types'
import { CommentCursor } from './cursor'

const mockState: {
  controlMode: ControlMode
  isCommentPlacing: boolean
  mousePosition: { elementX: number; elementY: number }
} = {
  controlMode: ControlMode.Pointer,
  isCommentPlacing: false,
  mousePosition: {
    elementX: 10,
    elementY: 20,
  },
}

vi.mock('../store', () => ({
  useStore: (selector: (state: typeof mockState) => unknown) => selector(mockState),
}))

describe('CommentCursor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when not in comment mode', () => {
    mockState.controlMode = ControlMode.Pointer

    const { container } = render(<CommentCursor />)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders at current mouse position when in comment mode', () => {
    mockState.controlMode = ControlMode.Comment
    mockState.isCommentPlacing = false

    const { container } = render(<CommentCursor />)

    expect(container.firstElementChild).toHaveStyle({ left: '10px', top: '20px' })
  })

  it('renders nothing when comment is in placing mode', () => {
    mockState.controlMode = ControlMode.Comment
    mockState.isCommentPlacing = true

    const { container } = render(<CommentCursor />)

    expect(container).toBeEmptyDOMElement()
  })
})
