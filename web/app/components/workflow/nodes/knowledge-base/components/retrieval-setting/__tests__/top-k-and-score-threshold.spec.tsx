import { fireEvent, render, screen } from '@testing-library/react'
import { TopKAndScoreThreshold } from '../top-k-and-score-threshold'

describe('TopKAndScoreThreshold', () => {
  const topKLabel = /datasetConfig\.top_k/
  const scoreThresholdLabel = /datasetConfig\.score_threshold/
  const defaultProps = {
    topK: {
      value: 3,
      onChange: vi.fn(),
    },
    scoreThreshold: {
      value: 0.4,
      onChange: vi.fn(),
      enabled: true,
      onEnabledChange: vi.fn(),
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should notify top-k input values without additional rounding', () => {
    render(<TopKAndScoreThreshold {...defaultProps} />)

    fireEvent.change(screen.getByRole('textbox', { name: topKLabel }), { target: { value: '3.7' } })

    expect(defaultProps.topK.onChange).toHaveBeenCalledWith(3.7)
  })

  it('should notify score-threshold input values without additional rounding', () => {
    render(<TopKAndScoreThreshold {...defaultProps} />)

    fireEvent.change(screen.getByRole('textbox', { name: scoreThresholdLabel }), { target: { value: '0.456' } })

    expect(defaultProps.scoreThreshold.onChange).toHaveBeenCalledWith(0.456)
  })

  it('should hide the score-threshold column when requested', () => {
    render(<TopKAndScoreThreshold {...defaultProps} scoreThreshold={{ hidden: true }} />)

    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })

  it('should fall back to zero when the number fields are cleared', () => {
    render(
      <TopKAndScoreThreshold
        {...defaultProps}
        scoreThreshold={{
          ...defaultProps.scoreThreshold,
          value: undefined,
          enabled: true,
        }}
      />,
    )

    const [topKInput, scoreThresholdInput] = screen.getAllByRole('textbox')
    fireEvent.change(topKInput!, { target: { value: '' } })

    expect(defaultProps.topK.onChange).toHaveBeenCalledWith(0)
    expect(scoreThresholdInput)!.toHaveValue('')
  })

  it('should default the score-threshold switch to off when the flag is missing', () => {
    render(
      <TopKAndScoreThreshold
        {...defaultProps}
        scoreThreshold={{
          ...defaultProps.scoreThreshold,
          enabled: undefined,
        }}
      />,
    )

    expect(screen.getByRole('switch', { name: scoreThresholdLabel }))!.toHaveAttribute('aria-checked', 'false')
  })
})
