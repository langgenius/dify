import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RetrievalSettings from '../RetrievalSettings'

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

  it('updates top K', async () => {
    const user = userEvent.setup()
    render(<RetrievalSettings {...defaultProps} />)

    await user.clear(screen.getByRole('textbox', { name: 'appDebug.datasetConfig.top_k' }))
    await user.type(screen.getByRole('textbox', { name: 'appDebug.datasetConfig.top_k' }), '8')

    expect(defaultProps.onChange).toHaveBeenCalledWith({ top_k: 8 })
  })

  it('updates the score threshold', async () => {
    const user = userEvent.setup()
    render(<RetrievalSettings {...defaultProps} scoreThresholdEnabled />)

    await user.clear(
      screen.getByRole('textbox', { name: 'appDebug.datasetConfig.score_threshold' }),
    )
    await user.type(
      screen.getByRole('textbox', { name: 'appDebug.datasetConfig.score_threshold' }),
      '0.9',
    )

    expect(defaultProps.onChange).toHaveBeenCalledWith({ score_threshold: 0.9 })
  })

  it('enables score threshold filtering', async () => {
    const user = userEvent.setup()
    render(<RetrievalSettings {...defaultProps} />)

    await user.click(screen.getByRole('switch', { name: 'appDebug.datasetConfig.score_threshold' }))

    expect(defaultProps.onChange).toHaveBeenCalledWith({ score_threshold_enabled: true })
  })
})
