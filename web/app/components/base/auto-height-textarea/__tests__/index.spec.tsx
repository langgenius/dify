import { render, screen } from '@testing-library/react'
import AutoHeightTextarea from '../index'

describe('AutoHeightTextarea', () => {
  it('moves focus and the cursor to the end when controlFocus changes', () => {
    const { rerender } = render(
      <AutoHeightTextarea value="hello" onChange={vi.fn()} controlFocus={1} />,
    )

    const input = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(input).toHaveFocus()
    expect(input.selectionStart).toBe(5)
    expect(input.selectionEnd).toBe(5)
    input.blur()

    rerender(<AutoHeightTextarea value="hello world" onChange={vi.fn()} controlFocus={2} />)

    expect(input).toHaveFocus()
    expect(input.selectionStart).toBe(11)
    expect(input.selectionEnd).toBe(11)
  })
})
