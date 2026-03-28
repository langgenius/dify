import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock param items to simplify testing
vi.mock('@/app/components/base/param-item/top-k-item', () => ({
  default: ({ value, onChange, enable }: { value: number, onChange: (key: string, val: number) => void, enable: boolean }) => (
    <div data-testid="top-k-item">
      <span data-testid="top-k-value">{value}</span>
      <button data-testid="top-k-change" onClick={() => onChange('top_k', 8)}>change</button>
      <span data-testid="top-k-enabled">{String(enable)}</span>
    </div>
  ),
}))

vi.mock('@/app/components/base/param-item/score-threshold-item', () => ({
  default: ({ value, onChange, enable, onSwitchChange }: { value: number, onChange: (key: string, val: number) => void, enable: boolean, onSwitchChange: (key: string, val: boolean) => void }) => (
    <div data-testid="score-threshold-item">
      <span data-testid="score-value">{value}</span>
      <button data-testid="score-change" onClick={() => onChange('score_threshold', 0.9)}>change</button>
      <span data-testid="score-enabled">{String(enable)}</span>
      <button data-testid="score-switch" onClick={() => onSwitchChange('score_threshold_enabled', true)}>switch</button>
    </div>
  ),
}))

const { default: RetrievalSettings } = await import('../RetrievalSettings')

describe('RetrievalSettings', () => {
  const defaultProps = {
    topK: 3,
    scoreThreshold: 0.5,
    scoreThresholdEnabled: false,
    onChange: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('should render TopKItem and ScoreThresholdItem', () => {
      render(<RetrievalSettings {...defaultProps} />)
      expect(screen.getByTestId('top-k-item')).toBeInTheDocument()
      expect(screen.getByTestId('score-threshold-item')).toBeInTheDocument()
    })

    it('should pass topK value to TopKItem', () => {
      render(<RetrievalSettings {...defaultProps} />)
      expect(screen.getByTestId('top-k-value').textContent).toBe('3')
    })

    it('should pass scoreThreshold to ScoreThresholdItem', () => {
      render(<RetrievalSettings {...defaultProps} />)
      expect(screen.getByTestId('score-value').textContent).toBe('0.5')
    })

    it('should show label when not in hit testing and not in retrieval setting', () => {
      render(<RetrievalSettings {...defaultProps} />)
      expect(screen.getByText('dataset.retrievalSettings')).toBeInTheDocument()
    })

    it('should hide label when isInHitTesting is true', () => {
      render(<RetrievalSettings {...defaultProps} isInHitTesting />)
      expect(screen.queryByText('dataset.retrievalSettings')).not.toBeInTheDocument()
    })

    it('should hide label when isInRetrievalSetting is true', () => {
      render(<RetrievalSettings {...defaultProps} isInRetrievalSetting />)
      expect(screen.queryByText('dataset.retrievalSettings')).not.toBeInTheDocument()
    })
  })

  describe('user interactions', () => {
    it('should call onChange with top_k when TopKItem changes', () => {
      render(<RetrievalSettings {...defaultProps} />)
      fireEvent.click(screen.getByTestId('top-k-change'))
      expect(defaultProps.onChange).toHaveBeenCalledWith({ top_k: 8 })
    })

    it('should call onChange with score_threshold when ScoreThresholdItem changes', () => {
      render(<RetrievalSettings {...defaultProps} />)
      fireEvent.click(screen.getByTestId('score-change'))
      expect(defaultProps.onChange).toHaveBeenCalledWith({ score_threshold: 0.9 })
    })

    it('should call onChange with score_threshold_enabled when switch changes', () => {
      render(<RetrievalSettings {...defaultProps} />)
      fireEvent.click(screen.getByTestId('score-switch'))
      expect(defaultProps.onChange).toHaveBeenCalledWith({ score_threshold_enabled: true })
    })
  })
})
