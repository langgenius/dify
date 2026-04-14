import { fireEvent, render, screen } from '@testing-library/react'
import TimeoutInput from '../timeout'

const mockUseTranslation = vi.hoisted(() => vi.fn())

vi.mock('react-i18next', () => ({
  useTranslation: () => mockUseTranslation(),
}))

vi.mock('@/app/components/base/input', () => ({
  __esModule: true,
  default: (props: {
    value: number
    disabled?: boolean
    onChange: (event: { target: { value: string } }) => void
  }) => (
    <input
      data-testid="timeout-input"
      value={props.value}
      disabled={props.disabled}
      onChange={e => props.onChange({ target: { value: e.target.value } })}
    />
  ),
}))

describe('TimeoutInput', () => {
  const onChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTranslation.mockReturnValue({
      t: (key: string) => key,
    })
  })

  it('should update the numeric timeout value and switch units', () => {
    render(
      <TimeoutInput
        timeout={3}
        unit="day"
        onChange={onChange}
      />,
    )

    fireEvent.change(screen.getByTestId('timeout-input'), { target: { value: '12' } })
    fireEvent.click(screen.getByText('nodes.humanInput.timeout.hours'))

    expect(onChange).toHaveBeenNthCalledWith(1, { timeout: 12, unit: 'day' })
    expect(onChange).toHaveBeenNthCalledWith(2, { timeout: 3, unit: 'hour' })
  })

  it('should fall back to 1 on invalid input and stay read-only when disabled', () => {
    const { rerender } = render(
      <TimeoutInput
        timeout={5}
        unit="hour"
        onChange={onChange}
      />,
    )

    fireEvent.change(screen.getByTestId('timeout-input'), { target: { value: 'abc' } })
    expect(onChange).toHaveBeenCalledWith({ timeout: 1, unit: 'hour' })

    rerender(
      <TimeoutInput
        timeout={5}
        unit="hour"
        onChange={onChange}
        readonly
      />,
    )

    fireEvent.click(screen.getByText('nodes.humanInput.timeout.days'))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('timeout-input')).toBeDisabled()
  })
})
