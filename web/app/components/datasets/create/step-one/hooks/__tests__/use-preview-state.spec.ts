import { act, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createElement } from 'react'
import usePreviewState from '../use-preview-state'

describe('usePreviewState', () => {
  it.each([true, false])('closes a file preview with restoreFocus=%s', async (restoreFocus) => {
    const user = userEvent.setup()
    const { result } = renderHook(() => usePreviewState())
    render(
      createElement(
        'div',
        null,
        createElement('button', { type: 'button' }, 'Preview file'),
        createElement('button', { type: 'button' }, 'Close preview'),
      ),
    )
    const trigger = screen.getByRole('button', { name: 'Preview file' })
    const close = screen.getByRole('button', { name: 'Close preview' })
    const file = new File(['content'], 'test.pdf')
    await user.click(trigger)
    act(() => result.current.showFilePreview(file))
    expect(result.current.currentFile).toBe(file)
    await user.click(close)
    act(() => result.current.hideFilePreview(restoreFocus))
    expect(result.current.currentFile).toBeUndefined()
    expect(restoreFocus ? trigger : close).toHaveFocus()
  })
})
