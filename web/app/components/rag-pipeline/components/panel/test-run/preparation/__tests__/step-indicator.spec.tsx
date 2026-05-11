import { render, screen } from '@testing-library/react'
import StepIndicator from '../step-indicator'

describe('StepIndicator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render all step labels and highlight the current step', () => {
    const { container } = render(
      <StepIndicator
        currentStep={2}
        steps={[
          { label: 'Select source', value: 'source' },
          { label: 'Process docs', value: 'process' },
          { label: 'Run test', value: 'run' },
        ]}
      />,
    )

    expect(screen.getByText('Select source')).toBeInTheDocument()
    expect(screen.getByText('Process docs')).toBeInTheDocument()
    expect(screen.getByText('Run test')).toBeInTheDocument()
    expect(container.querySelector('.bg-state-accent-solid')).toBeInTheDocument()
    expect(screen.getByText('Process docs').parentElement).toHaveClass('text-state-accent-solid')
  })

  it('should keep inactive steps in the tertiary state', () => {
    render(
      <StepIndicator
        currentStep={1}
        steps={[
          { label: 'Select source', value: 'source' },
          { label: 'Process docs', value: 'process' },
        ]}
      />,
    )

    expect(screen.getByText('Process docs').parentElement).toHaveClass('text-text-tertiary')
  })
})
