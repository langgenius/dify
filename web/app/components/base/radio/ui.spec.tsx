import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
// radio-ui.spec.tsx
import { describe, expect, it, vi } from 'vitest'
import RadioUI from './ui'

describe('RadioUI component', () => {
  it('renders with correct role and aria attributes', () => {
    render(<RadioUI isChecked />)

    const radio = screen.getByRole('radio')
    expect(radio).toBeInTheDocument()
    expect(radio).toHaveAttribute('aria-checked', 'true')
    expect(radio).toHaveAttribute('aria-disabled', 'false')
  })

  it('applies checked + enabled styles', () => {
    render(<RadioUI isChecked />)
    const radio = screen.getByRole('radio')
    expect(radio.className).toContain('border-[5px]')
    expect(radio.className).toContain('border-components-radio-border-checked')
  })

  it('applies unchecked + enabled styles', () => {
    render(<RadioUI isChecked={false} />)
    const radio = screen.getByRole('radio')
    expect(radio.className).toContain('border-components-radio-border')
  })

  it('applies checked + disabled styles', () => {
    render(<RadioUI isChecked disabled />)
    const radio = screen.getByRole('radio')
    expect(radio).toHaveAttribute('aria-disabled', 'true')
    expect(radio.className).toContain(
      'border-components-radio-border-checked-disabled',
    )
  })

  it('applies unchecked + disabled styles', () => {
    render(<RadioUI isChecked={false} disabled />)
    const radio = screen.getByRole('radio')
    expect(radio.className).toContain(
      'border-components-radio-border-disabled',
    )
    expect(radio.className).toContain(
      'bg-components-radio-bg-disabled',
    )
  })

  it('calls onCheck when clicked if not disabled', async () => {
    const user = userEvent.setup()
    const handleCheck = vi.fn()

    render(<RadioUI isChecked={false} onCheck={handleCheck} />)

    const radio = screen.getByRole('radio')
    await user.click(radio)

    expect(handleCheck).toHaveBeenCalledTimes(1)
  })

  it('does not call onCheck when disabled', async () => {
    const user = userEvent.setup()
    const handleCheck = vi.fn()

    render(
      <RadioUI isChecked={false} disabled onCheck={handleCheck} />,
    )

    const radio = screen.getByRole('radio')
    await user.click(radio)

    expect(handleCheck).not.toHaveBeenCalled()
  })

  it('merges custom className', () => {
    render(
      <RadioUI isChecked={false} className="my-extra-class" />,
    )
    const radio = screen.getByRole('radio')
    expect(radio.className).toContain('my-extra-class')
  })

  it('memo export renders correctly', () => {
    render(<RadioUI isChecked />)
    expect(screen.getByRole('radio')).toBeInTheDocument()
  })
})
