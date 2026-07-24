import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import PromptEditorHeightResizeWrap from './prompt-editor-height-resize-wrap'

describe('PromptEditorHeightResizeWrap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('should render children, footer, and hide resize handler when requested', () => {
    const { container } = render(
      <PromptEditorHeightResizeWrap
        className="wrapper"
        height={150}
        minHeight={100}
        onHeightChange={vi.fn()}
        footer={<div>footer</div>}
        hideResize
      >
        <div>content</div>
      </PromptEditorHeightResizeWrap>,
    )

    expect(screen.getByText('content')).toBeInTheDocument()
    expect(screen.getByText('footer')).toBeInTheDocument()
    expect(container.querySelector('.cursor-row-resize')).toBeNull()
  })

  it('should resize height with mouse events and clamp to minHeight', () => {
    const onHeightChange = vi.fn()

    const { container } = render(
      <PromptEditorHeightResizeWrap
        height={150}
        minHeight={100}
        onHeightChange={onHeightChange}
      >
        <div>content</div>
      </PromptEditorHeightResizeWrap>,
    )

    const handle = container.querySelector('.cursor-row-resize')
    expect(handle).not.toBeNull()

    fireEvent.mouseDown(handle as Element, { clientY: 100 })
    expect(document.body.style.userSelect).toBe('none')

    fireEvent.mouseMove(document, { clientY: 130 })
    vi.runAllTimers()
    expect(onHeightChange).toHaveBeenLastCalledWith(180)

    onHeightChange.mockClear()
    fireEvent.mouseMove(document, { clientY: -100 })
    vi.runAllTimers()
    expect(onHeightChange).toHaveBeenLastCalledWith(100)

    fireEvent.mouseUp(document)
    expect(document.body.style.userSelect).toBe('')
  })
})
