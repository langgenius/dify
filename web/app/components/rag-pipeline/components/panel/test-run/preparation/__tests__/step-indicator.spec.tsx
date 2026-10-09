import { render, screen, within } from '@testing-library/react'
import StepIndicator from '../step-indicator'

describe('StepIndicator', () => {
  it('identifies the current step in the ordered preparation flow', () => {
    const steps = [
      { label: 'Select source', value: 'source' },
      { label: 'Process docs', value: 'process' },
      { label: 'Run test', value: 'run' },
    ]
    const { rerender } = render(<StepIndicator currentStep={2} steps={steps} />)
    const items = within(screen.getByRole('list')).getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(items[1]).toHaveAttribute('aria-current', 'step')
    expect(items[1]).toHaveTextContent('Process docs')
    expect(items[0]).not.toHaveAttribute('aria-current')
    rerender(<StepIndicator currentStep={3} steps={steps} />)
    expect(items[1]).not.toHaveAttribute('aria-current')
    expect(items[2]).toHaveAttribute('aria-current', 'step')
  })
})
