import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { withSelectorKey } from '@/test/i18n-mock'
import TimeoutInput from '../timeout'

const mockUseTranslation = vi.hoisted(() => vi.fn())

vi.mock('react-i18next', () => ({
  useTranslation: () => mockUseTranslation(),
}))

describe('TimeoutInput', () => {
  const onChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTranslation.mockReturnValue({
      t: withSelectorKey((key: string) => key),
    })
  })

  it('keeps a pasted fractional timeout and unit changes within the integer contract', async () => {
    const user = userEvent.setup()
    const ControlledTimeout = () => {
      const [state, setState] = useState<{ timeout: number; unit: 'day' | 'hour' }>({
        timeout: 3,
        unit: 'hour',
      })
      return (
        <TimeoutInput
          {...state}
          onChange={(next) => {
            onChange(next)
            setState(next)
          }}
        />
      )
    }
    render(<ControlledTimeout />)

    const input = screen.getByRole('textbox', { name: 'nodes.humanInput.timeout.title' })
    await user.clear(input)
    await user.paste('1.5')
    await user.tab()

    expect(input).toHaveValue('2')
    expect(onChange).toHaveBeenLastCalledWith({ timeout: 2, unit: 'hour' })
    expect(onChange.mock.calls.every(([value]) => Number.isInteger(value.timeout))).toBe(true)

    await user.click(screen.getByRole('radio', { name: 'nodes.humanInput.timeout.days' }))
    expect(onChange).toHaveBeenLastCalledWith({ timeout: 2, unit: 'day' })
  })

  it('does not preserve an imported fractional timeout when switching units', async () => {
    const user = userEvent.setup()
    render(<TimeoutInput timeout={1.5} unit="hour" onChange={onChange} />)

    await user.click(screen.getByRole('radio', { name: 'nodes.humanInput.timeout.days' }))

    expect(onChange).toHaveBeenCalledExactlyOnceWith({ timeout: 2, unit: 'day' })
  })
})
