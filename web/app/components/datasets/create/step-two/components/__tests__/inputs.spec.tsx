import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DelimiterInput, MaxLengthInput, OverlapInput } from '../inputs'

describe('DelimiterInput', () => {
  it('commits the delimiter only after IME composition ends', () => {
    const onValueChange = vi.fn()
    render(<DelimiterInput value="" onValueChange={onValueChange} />)
    const input = screen.getByRole('textbox', { name: 'datasetCreation.stepTwo.separator' })

    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: 'w' } })
    fireEvent.change(input, { target: { value: '文' } })
    expect(onValueChange).not.toHaveBeenCalled()

    fireEvent.compositionEnd(input)
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith('文')
  })
})

describe.each([
  { Component: MaxLengthInput, label: 'datasetCreation.stepTwo.maxLength' },
  { Component: OverlapInput, label: 'datasetCreation.stepTwo.overlap' },
])('$label', ({ Component, label }) => {
  it('resets to the minimum when users clear the value', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Component value={50} onChange={onChange} />)

    await user.clear(screen.getByRole('textbox', { name: label }))
    expect(onChange).toHaveBeenLastCalledWith(1)
  })

  it('clamps out-of-range edits before updating chunk settings', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Component value={50} max={100} onChange={onChange} />)

    await user.tripleClick(screen.getByRole('textbox', { name: label }))
    await user.paste('150')
    expect(onChange).toHaveBeenLastCalledWith(100)
  })
})
