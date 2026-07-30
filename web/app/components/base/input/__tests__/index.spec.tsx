import type { ChangeEvent } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Input from '../index'

describe('Input', () => {
  it('disables the input and hides its clear action', () => {
    render(<Input showClearIcon value="test" disabled />)

    expect(screen.getByRole('textbox')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'common.operation.clear' })).not.toBeInTheDocument()
  })

  it('clears an editable value', async () => {
    const user = userEvent.setup()
    const onClear = vi.fn()
    render(<Input showClearIcon value="test" onClear={onClear} />)

    await user.click(screen.getByRole('button', { name: 'common.operation.clear' }))

    expect(onClear).toHaveBeenCalledOnce()
  })

  it('normalizes leading zeros while changing an initial numeric zero', () => {
    let changedValue = ''
    const onChange = vi.fn((event: ChangeEvent<HTMLInputElement>) => {
      changedValue = event.target.value
    })
    render(<Input type="number" value={0} onChange={onChange} />)

    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '00042' } })

    expect(onChange).toHaveBeenCalledOnce()
    expect(changedValue).toBe('42')
  })

  it('normalizes leading zeros before forwarding blur', () => {
    const onChange = vi.fn()
    const onBlur = vi.fn()
    render(<Input type="number" defaultValue="0012" onChange={onChange} onBlur={onBlur} />)

    fireEvent.blur(screen.getByRole('spinbutton'))

    expect(onChange.mock.calls[0]![0].target.value).toBe('12')
    expect(onBlur.mock.calls[0]![0].target.value).toBe('12')
  })
})
