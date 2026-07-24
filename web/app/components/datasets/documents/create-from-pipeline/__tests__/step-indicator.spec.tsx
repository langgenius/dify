import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import StepIndicator from '../step-indicator'

describe('StepIndicator', () => {
  const steps = [
    { label: 'Data Source', value: 'data-source' },
    { label: 'Process', value: 'process' },
    { label: 'Embedding', value: 'embedding' },
  ]

  it('should render dots for each step', () => {
    const { container } = render(<StepIndicator steps={steps} currentStep={1} />)
    const dots = container.querySelectorAll('.rounded-lg')
    expect(dots).toHaveLength(3)
  })

  it('should apply active style to current step', () => {
    const { container } = render(<StepIndicator steps={steps} currentStep={2} />)
    const dots = container.querySelectorAll('.rounded-lg')
    // Second step (index 1) should be active
    expect(dots[1].className).toContain('bg-state-accent-solid')
    expect(dots[1].className).toContain('w-2')
  })

  it('should not apply active style to non-current steps', () => {
    const { container } = render(<StepIndicator steps={steps} currentStep={1} />)
    const dots = container.querySelectorAll('.rounded-lg')
    expect(dots[1].className).toContain('bg-divider-solid')
    expect(dots[2].className).toContain('bg-divider-solid')
  })
})
