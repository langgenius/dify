import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/app/components/base/param-item/top-k-item', () => ({
  default: ({ onChange }: { onChange: (key: string, value: number) => void }) => (
    <button type="button" onClick={() => onChange('top_k', 8)}>
      Set top K to 8
    </button>
  ),
}))

vi.mock('@/app/components/base/param-item/score-threshold-item', () => ({
  default: ({
    onChange,
    onSwitchChange,
  }: {
    onChange: (key: string, value: number) => void
    onSwitchChange: (key: string, value: boolean) => void
  }) => (
    <div>
      <button type="button" onClick={() => onChange('score_threshold', 0.9)}>
        Set score threshold to 0.9
      </button>
      <button type="button" onClick={() => onSwitchChange('score_threshold_enabled', true)}>
        Enable score threshold
      </button>
    </div>
  ),
}))

const { default: RetrievalSettings } = await import('../RetrievalSettings')

const defaultProps = {
  topK: 3,
  scoreThreshold: 0.5,
  scoreThresholdEnabled: false,
  onChange: vi.fn(),
}

describe('RetrievalSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows its heading in the standalone retrieval settings', () => {
    render(<RetrievalSettings {...defaultProps} />)

    expect(screen.getByText('dataset.retrievalSettings')).toBeInTheDocument()
  })

  it('hides the duplicate heading when embedded in hit testing', () => {
    render(<RetrievalSettings {...defaultProps} isInHitTesting />)

    expect(screen.queryByText('dataset.retrievalSettings')).not.toBeInTheDocument()
  })

  it('updates top K', async () => {
    const user = userEvent.setup()
    render(<RetrievalSettings {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: 'Set top K to 8' }))

    expect(defaultProps.onChange).toHaveBeenCalledWith({ top_k: 8 })
  })

  it('updates the score threshold', async () => {
    const user = userEvent.setup()
    render(<RetrievalSettings {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: 'Set score threshold to 0.9' }))

    expect(defaultProps.onChange).toHaveBeenCalledWith({ score_threshold: 0.9 })
  })

  it('enables score threshold filtering', async () => {
    const user = userEvent.setup()
    render(<RetrievalSettings {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: 'Enable score threshold' }))

    expect(defaultProps.onChange).toHaveBeenCalledWith({ score_threshold_enabled: true })
  })
})
