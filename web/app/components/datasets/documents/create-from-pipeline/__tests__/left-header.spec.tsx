import type { Step } from '../step-indicator'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LeftHeader from '../left-header'

vi.mock('next/navigation', () => ({
  useParams: () => ({ datasetId: 'test-ds-id' }),
}))

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode, href: string }) => (
    <a href={href} data-testid="back-link">{children}</a>
  ),
}))

vi.mock('../step-indicator', () => ({
  default: ({ steps, currentStep }: { steps: Step[], currentStep: number }) => (
    <div data-testid="step-indicator" data-steps={steps.length} data-current={currentStep} />
  ),
}))

vi.mock('@/app/components/base/effect', () => ({
  default: ({ className }: { className?: string }) => (
    <div data-testid="effect" className={className} />
  ),
}))

const createSteps = (): Step[] => [
  { label: 'Data Source', value: 'data-source' },
  { label: 'Processing', value: 'processing' },
  { label: 'Complete', value: 'complete' },
]

describe('LeftHeader', () => {
  const steps = createSteps()

  const defaultProps = {
    steps,
    title: 'Add Documents',
    currentStep: 1,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering: title, step label, and step indicator
  describe('Rendering', () => {
    it('should render title text', () => {
      render(<LeftHeader {...defaultProps} />)

      expect(screen.getByText('Add Documents')).toBeInTheDocument()
    })

    it('should render current step label (steps[currentStep-1].label)', () => {
      render(<LeftHeader {...defaultProps} currentStep={2} />)

      expect(screen.getByText('Processing')).toBeInTheDocument()
    })

    it('should render step indicator component', () => {
      render(<LeftHeader {...defaultProps} />)

      expect(screen.getByTestId('step-indicator')).toBeInTheDocument()
    })

    it('should render separator between title and step indicator', () => {
      render(<LeftHeader {...defaultProps} />)

      expect(screen.getByText('/')).toBeInTheDocument()
    })
  })

  // Back button visibility depends on currentStep vs total steps
  describe('Back Button', () => {
    it('should show back button when currentStep !== steps.length', () => {
      render(<LeftHeader {...defaultProps} currentStep={1} />)

      expect(screen.getByTestId('back-link')).toBeInTheDocument()
    })

    it('should hide back button when currentStep === steps.length', () => {
      render(<LeftHeader {...defaultProps} currentStep={steps.length} />)

      expect(screen.queryByTestId('back-link')).not.toBeInTheDocument()
    })

    it('should link to correct URL using datasetId from params', () => {
      render(<LeftHeader {...defaultProps} currentStep={1} />)

      const link = screen.getByTestId('back-link')
      expect(link).toHaveAttribute('href', '/datasets/test-ds-id/documents')
    })
  })

  // Edge case: step label for boundary values
  describe('Edge Cases', () => {
    it('should render first step label when currentStep is 1', () => {
      render(<LeftHeader {...defaultProps} currentStep={1} />)

      expect(screen.getByText('Data Source')).toBeInTheDocument()
    })

    it('should render last step label when currentStep equals steps.length', () => {
      render(<LeftHeader {...defaultProps} currentStep={3} />)

      expect(screen.getByText('Complete')).toBeInTheDocument()
    })
  })
})
