import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StepperStep } from '../step'

describe('StepperStep', () => {
  it('should render step name', () => {
    render(<StepperStep name="Configure" index={0} activeIndex={0} />)
    expect(screen.getByText('Configure')).toBeInTheDocument()
  })

  it('should show "STEP N" label for active step', () => {
    render(<StepperStep name="Configure" index={1} activeIndex={1} />)
    expect(screen.getByText('STEP 2')).toBeInTheDocument()
  })

  it('should show just number for non-active step', () => {
    render(<StepperStep name="Configure" index={1} activeIndex={0} />)
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('should apply accent style for active step', () => {
    render(<StepperStep name="Step A" index={0} activeIndex={0} />)
    const nameEl = screen.getByText('Step A')
    expect(nameEl.className).toContain('text-text-accent')
  })

  it('should apply disabled style for future step', () => {
    render(<StepperStep name="Step C" index={2} activeIndex={0} />)
    const nameEl = screen.getByText('Step C')
    expect(nameEl.className).toContain('text-text-quaternary')
  })
})
