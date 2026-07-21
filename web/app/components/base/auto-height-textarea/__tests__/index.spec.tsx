import { render, screen } from '@testing-library/react'
import AutoHeightTextarea from '../index'

describe('AutoHeightTextarea', () => {
  it('moves focus and the cursor to the end when controlFocus changes', () => {
    const focus = vi.spyOn(HTMLTextAreaElement.prototype, 'focus')
    const setSelectionRange = vi.spyOn(HTMLTextAreaElement.prototype, 'setSelectionRange')
    const { rerender } = render(
      <AutoHeightTextarea value="hello" onChange={vi.fn()} controlFocus={1} />,
    )

    expect(screen.getByRole('textbox')).toHaveValue('hello')
    expect(focus).toHaveBeenCalledOnce()
    expect(setSelectionRange).toHaveBeenLastCalledWith(5, 5)

    rerender(<AutoHeightTextarea value="hello world" onChange={vi.fn()} controlFocus={2} />)

    expect(focus).toHaveBeenCalledTimes(2)
    expect(setSelectionRange).toHaveBeenLastCalledWith(11, 11)

    focus.mockRestore()
    setSelectionRange.mockRestore()
  })
})
