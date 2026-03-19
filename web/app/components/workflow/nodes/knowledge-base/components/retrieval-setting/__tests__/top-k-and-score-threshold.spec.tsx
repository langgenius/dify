import { fireEvent, render, screen } from '@testing-library/react'
import TopKAndScoreThreshold from '../top-k-and-score-threshold'

describe('TopKAndScoreThreshold', () => {
  const defaultProps = {
    topK: 3,
    onTopKChange: vi.fn(),
    scoreThreshold: 0.4,
    onScoreThresholdChange: vi.fn(),
    isScoreThresholdEnabled: true,
    onScoreThresholdEnabledChange: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should round top-k input values before notifying the parent', () => {
    render(<TopKAndScoreThreshold {...defaultProps} />)

    const [topKInput] = screen.getAllByRole('textbox')
    fireEvent.change(topKInput, { target: { value: '3.7' } })

    expect(defaultProps.onTopKChange).toHaveBeenCalledWith(4)
  })

  it('should round score-threshold input values to two decimals', () => {
    render(<TopKAndScoreThreshold {...defaultProps} />)

    const [, scoreThresholdInput] = screen.getAllByRole('textbox')
    fireEvent.change(scoreThresholdInput, { target: { value: '0.456' } })

    expect(defaultProps.onScoreThresholdChange).toHaveBeenCalledWith(0.46)
  })

  it('should hide the score-threshold column when requested', () => {
    render(<TopKAndScoreThreshold {...defaultProps} hiddenScoreThreshold />)

    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })

  it('should fall back to zero when the number fields are cleared', () => {
    render(
      <TopKAndScoreThreshold
        {...defaultProps}
        scoreThreshold={undefined}
        isScoreThresholdEnabled
      />,
    )

    const [topKInput, scoreThresholdInput] = screen.getAllByRole('textbox')
    fireEvent.change(topKInput, { target: { value: '' } })

    expect(defaultProps.onTopKChange).toHaveBeenCalledWith(0)
    expect(scoreThresholdInput).toHaveValue('')
  })

  it('should default the score-threshold switch to off when the flag is missing', () => {
    render(
      <TopKAndScoreThreshold
        {...defaultProps}
        isScoreThresholdEnabled={undefined}
      />,
    )

    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  })
})
