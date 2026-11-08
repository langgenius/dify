import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import FeatureCard from '../feature-card'

it('labels the feature switch and respects a disabled feature after selection', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  function Feature({ disabled = false }: { disabled?: boolean }) {
    const [enabled, setEnabled] = useState(false)
    return (
      <FeatureCard
        icon={null}
        title="Conversation starters"
        value={enabled}
        disabled={disabled}
        onChange={(value) => {
          setEnabled(value)
          onChange(value)
        }}
      />
    )
  }
  const { rerender } = render(<Feature />)
  const toggle = screen.getByRole('switch', { name: 'Conversation starters' })
  await user.click(toggle)
  expect(toggle).toBeChecked()
  expect(onChange).toHaveBeenCalledExactlyOnceWith(true)
  rerender(<Feature disabled />)
  expect(toggle).toHaveAttribute('aria-disabled', 'true')
  await user.click(toggle)
  expect(toggle).toBeChecked()
  expect(onChange).toHaveBeenCalledTimes(1)
})
