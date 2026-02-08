import type { RefObject } from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import StepTwoContent from './step-two-content'

// Mock ProcessDocuments component as it has complex hook dependencies
vi.mock('../process-documents', () => ({
  default: vi.fn().mockImplementation(({
    dataSourceNodeId,
    isRunning,
    onProcess,
    onPreview,
    onSubmit,
    onBack,
  }: {
    dataSourceNodeId: string
    isRunning: boolean
    onProcess: () => void
    onPreview: () => void
    onSubmit: (data: Record<string, unknown>) => void
    onBack: () => void
  }) => (
    <div data-testid="process-documents">
      <span data-testid="data-source-node-id">{dataSourceNodeId}</span>
      <span data-testid="is-running">{String(isRunning)}</span>
      <button data-testid="process-btn" onClick={onProcess}>Process</button>
      <button data-testid="preview-btn" onClick={onPreview}>Preview</button>
      <button data-testid="submit-btn" onClick={() => onSubmit({ key: 'value' })}>Submit</button>
      <button data-testid="back-btn" onClick={onBack}>Back</button>
    </div>
  )),
}))

describe('StepTwoContent', () => {
  const mockFormRef: RefObject<{ submit: () => void } | null> = { current: null }

  const defaultProps = {
    formRef: mockFormRef,
    dataSourceNodeId: 'test-node-id',
    isRunning: false,
    onProcess: vi.fn(),
    onPreview: vi.fn(),
    onSubmit: vi.fn(),
    onBack: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<StepTwoContent {...defaultProps} />)
      expect(screen.getByTestId('process-documents')).toBeInTheDocument()
    })

    it('should render ProcessDocuments component', () => {
      render(<StepTwoContent {...defaultProps} />)
      expect(screen.getByTestId('process-documents')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should pass dataSourceNodeId to ProcessDocuments', () => {
      render(<StepTwoContent {...defaultProps} />)
      expect(screen.getByTestId('data-source-node-id')).toHaveTextContent('test-node-id')
    })

    it('should pass isRunning false to ProcessDocuments', () => {
      render(<StepTwoContent {...defaultProps} isRunning={false} />)
      expect(screen.getByTestId('is-running')).toHaveTextContent('false')
    })

    it('should pass isRunning true to ProcessDocuments', () => {
      render(<StepTwoContent {...defaultProps} isRunning={true} />)
      expect(screen.getByTestId('is-running')).toHaveTextContent('true')
    })

    it('should pass different dataSourceNodeId', () => {
      render(<StepTwoContent {...defaultProps} dataSourceNodeId="different-node-id" />)
      expect(screen.getByTestId('data-source-node-id')).toHaveTextContent('different-node-id')
    })
  })

  describe('User Interactions', () => {
    it('should call onProcess when process button is clicked', () => {
      const onProcess = vi.fn()
      render(<StepTwoContent {...defaultProps} onProcess={onProcess} />)

      screen.getByTestId('process-btn').click()

      expect(onProcess).toHaveBeenCalledTimes(1)
    })

    it('should call onPreview when preview button is clicked', () => {
      const onPreview = vi.fn()
      render(<StepTwoContent {...defaultProps} onPreview={onPreview} />)

      screen.getByTestId('preview-btn').click()

      expect(onPreview).toHaveBeenCalledTimes(1)
    })

    it('should call onSubmit when submit button is clicked', () => {
      const onSubmit = vi.fn()
      render(<StepTwoContent {...defaultProps} onSubmit={onSubmit} />)

      screen.getByTestId('submit-btn').click()

      expect(onSubmit).toHaveBeenCalledTimes(1)
      expect(onSubmit).toHaveBeenCalledWith({ key: 'value' })
    })

    it('should call onBack when back button is clicked', () => {
      const onBack = vi.fn()
      render(<StepTwoContent {...defaultProps} onBack={onBack} />)

      screen.getByTestId('back-btn').click()

      expect(onBack).toHaveBeenCalledTimes(1)
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty dataSourceNodeId', () => {
      render(<StepTwoContent {...defaultProps} dataSourceNodeId="" />)
      expect(screen.getByTestId('data-source-node-id')).toHaveTextContent('')
    })

    it('should handle null formRef', () => {
      const nullRef = { current: null }
      render(<StepTwoContent {...defaultProps} formRef={nullRef} />)
      expect(screen.getByTestId('process-documents')).toBeInTheDocument()
    })
  })
})
