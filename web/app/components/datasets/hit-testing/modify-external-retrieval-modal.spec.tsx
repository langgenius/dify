import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ModifyExternalRetrievalModal from './modify-external-retrieval-modal'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@remixicon/react', () => ({
  RiCloseLine: () => <span data-testid="close-icon" />,
}))

vi.mock('@/app/components/base/action-button', () => ({
  default: ({ children, onClick }: { children: React.ReactNode, onClick: () => void }) => (
    <button data-testid="action-button" onClick={onClick}>{children}</button>
  ),
}))

vi.mock('@/app/components/base/button', () => ({
  default: ({ children, onClick, variant }: { children: React.ReactNode, onClick: () => void, variant?: string }) => (
    <button data-testid={variant === 'primary' ? 'save-button' : 'cancel-button'} onClick={onClick}>
      {children}
    </button>
  ),
}))

vi.mock('../external-knowledge-base/create/RetrievalSettings', () => ({
  default: ({ topK, scoreThreshold, _scoreThresholdEnabled, onChange }: { topK: number, scoreThreshold: number, _scoreThresholdEnabled: boolean, onChange: (data: Record<string, unknown>) => void }) => (
    <div data-testid="retrieval-settings">
      <span data-testid="top-k">{topK}</span>
      <span data-testid="score-threshold">{scoreThreshold}</span>
      <button data-testid="change-top-k" onClick={() => onChange({ top_k: 10 })}>change</button>
    </div>
  ),
}))

describe('ModifyExternalRetrievalModal', () => {
  const defaultProps = {
    onClose: vi.fn(),
    onSave: vi.fn(),
    initialTopK: 4,
    initialScoreThreshold: 0.5,
    initialScoreThresholdEnabled: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render title', () => {
    render(<ModifyExternalRetrievalModal {...defaultProps} />)
    expect(screen.getByText('settingTitle')).toBeInTheDocument()
  })

  it('should render retrieval settings with initial values', () => {
    render(<ModifyExternalRetrievalModal {...defaultProps} />)
    expect(screen.getByTestId('top-k')).toHaveTextContent('4')
    expect(screen.getByTestId('score-threshold')).toHaveTextContent('0.5')
  })

  it('should call onClose when close button clicked', () => {
    render(<ModifyExternalRetrievalModal {...defaultProps} />)
    fireEvent.click(screen.getByTestId('action-button'))
    expect(defaultProps.onClose).toHaveBeenCalled()
  })

  it('should call onClose when cancel button clicked', () => {
    render(<ModifyExternalRetrievalModal {...defaultProps} />)
    fireEvent.click(screen.getByTestId('cancel-button'))
    expect(defaultProps.onClose).toHaveBeenCalled()
  })

  it('should call onSave with current values and close when save clicked', () => {
    render(<ModifyExternalRetrievalModal {...defaultProps} />)
    fireEvent.click(screen.getByTestId('save-button'))
    expect(defaultProps.onSave).toHaveBeenCalledWith({
      top_k: 4,
      score_threshold: 0.5,
      score_threshold_enabled: false,
    })
    expect(defaultProps.onClose).toHaveBeenCalled()
  })

  it('should save updated values after settings change', () => {
    render(<ModifyExternalRetrievalModal {...defaultProps} />)
    fireEvent.click(screen.getByTestId('change-top-k'))
    fireEvent.click(screen.getByTestId('save-button'))
    expect(defaultProps.onSave).toHaveBeenCalledWith(
      expect.objectContaining({ top_k: 10 }),
    )
  })
})
