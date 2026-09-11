import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import ConfigString from '../index'

function LengthField({ maxLength = 10, initialValue = 5, onChange = vi.fn() }) {
  const [value, setValue] = useState<number | undefined>(initialValue)
  return (
    <>
      <label htmlFor="max-length">Maximum length</label>
      <ConfigString
        id="max-length"
        value={value}
        maxLength={maxLength}
        modelId="model-id"
        onChange={(nextValue) => {
          setValue(nextValue)
          onChange(nextValue)
        }}
      />
    </>
  )
}

describe('ConfigString', () => {
  it.each([
    ['12', '10', 10],
    ['0', '1', 1],
    ['7.8', '8', 8],
  ])('commits %s as a bounded integer', async (entered, displayed, expected) => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<LengthField onChange={onChange} />)
    const input = screen.getByRole('textbox', { name: 'Maximum length' })
    await user.clear(input)
    await user.type(input, entered)
    await user.tab()
    expect(input).toHaveValue(displayed)
    expect(onChange).toHaveBeenLastCalledWith(expected)
  })

  it('clears to an unset value instead of NaN', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<LengthField onChange={onChange} />)
    const input = screen.getByRole('textbox', { name: 'Maximum length' })
    await user.clear(input)
    await user.tab()
    expect(input).toHaveValue('')
    expect(onChange).toHaveBeenLastCalledWith(undefined)
  })

  it('updates the draft when the allowed maximum becomes smaller', async () => {
    const onChange = vi.fn()
    const { rerender } = render(<LengthField initialValue={9} onChange={onChange} />)
    rerender(<LengthField initialValue={9} maxLength={6} onChange={onChange} />)
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(6))
    expect(screen.getByRole('textbox', { name: 'Maximum length' })).toHaveValue('6')
  })
})
