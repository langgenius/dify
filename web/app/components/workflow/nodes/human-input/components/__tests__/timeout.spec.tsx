import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

  it('should update the timeout with the keyboard and switch units', async () => {
    const user = userEvent.setup()
    render(<TimeoutInput timeout={3} unit="day" onChange={onChange} />)

    const timeoutInput = screen.getByRole('textbox', { name: 'nodes.humanInput.timeout.title' })
    await user.click(timeoutInput)
    await user.keyboard('{ArrowUp}')
    await user.click(screen.getByRole('radio', { name: 'nodes.humanInput.timeout.hours' }))

    expect(onChange).toHaveBeenNthCalledWith(1, { timeout: 4, unit: 'day' })
    expect(onChange).toHaveBeenNthCalledWith(2, { timeout: 3, unit: 'hour' })
  })

  it('should fall back to 1 when cleared and stay read-only when disabled', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<TimeoutInput timeout={5} unit="hour" onChange={onChange} />)

    const timeoutInput = screen.getByRole('textbox', { name: 'nodes.humanInput.timeout.title' })
    await user.clear(timeoutInput)
    expect(onChange).toHaveBeenCalledWith({ timeout: 1, unit: 'hour' })

    rerender(<TimeoutInput timeout={5} unit="hour" onChange={onChange} readonly />)

    await user.click(screen.getByRole('radio', { name: 'nodes.humanInput.timeout.days' }))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('textbox', { name: 'nodes.humanInput.timeout.title' })).toBeDisabled()
    expect(screen.getByRole('radio', { name: 'nodes.humanInput.timeout.days' })).toBeDisabled()
  })
})
