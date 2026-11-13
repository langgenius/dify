import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { TopKAndScoreThreshold } from '../top-k-and-score-threshold'

const topKLabel = /datasetConfig\.top_k/
const scoreThresholdLabel = /datasetConfig\.score_threshold/

function Settings({ onTopKChange = vi.fn(), onScoreChange = vi.fn() }) {
  const [topK, setTopK] = useState(3)
  const [score, setScore] = useState(0.4)
  const [enabled, setEnabled] = useState(true)
  return (
    <TopKAndScoreThreshold
      topK={{
        value: topK,
        onChange: (value) => {
          setTopK(value)
          onTopKChange(value)
        },
      }}
      scoreThreshold={{
        value: score,
        onChange: (value) => {
          setScore(value)
          onScoreChange(value)
        },
        enabled,
        onEnabledChange: setEnabled,
      }}
    />
  )
}

it('preserves typed precision before committing retrieval values', async () => {
  const user = userEvent.setup()
  const onTopKChange = vi.fn()
  const onScoreChange = vi.fn()
  render(<Settings onTopKChange={onTopKChange} onScoreChange={onScoreChange} />)
  const topK = screen.getByRole('textbox', { name: topKLabel })
  await user.clear(topK)
  await user.type(topK, '3.7')
  expect(onTopKChange).toHaveBeenLastCalledWith(3.7)
  const score = screen.getByRole('textbox', { name: scoreThresholdLabel })
  await user.clear(score)
  await user.type(score, '0.456')
  expect(onScoreChange).toHaveBeenLastCalledWith(0.456)
})

it('maps clearing either retrieval value to zero', async () => {
  const user = userEvent.setup()
  const onTopKChange = vi.fn()
  const onScoreChange = vi.fn()
  render(<Settings onTopKChange={onTopKChange} onScoreChange={onScoreChange} />)
  await user.clear(screen.getByRole('textbox', { name: topKLabel }))
  expect(onTopKChange).toHaveBeenLastCalledWith(0)
  await user.clear(screen.getByRole('textbox', { name: scoreThresholdLabel }))
  expect(onScoreChange).toHaveBeenLastCalledWith(0)
})

it('disables threshold editing when filtering is switched off and restores its value when enabled', async () => {
  const user = userEvent.setup()
  render(<Settings />)
  const toggle = screen.getByRole('switch', { name: scoreThresholdLabel })
  const score = screen.getByRole('textbox', { name: scoreThresholdLabel })
  await user.click(toggle)
  expect(score).toBeDisabled()
  await user.click(toggle)
  expect(score).toBeEnabled()
  expect(score).toHaveValue('0.4')
})

it('omits threshold controls when the retrieval mode hides them', () => {
  render(
    <TopKAndScoreThreshold
      topK={{ value: 3, onChange: vi.fn() }}
      scoreThreshold={{ hidden: true }}
    />,
  )
  expect(screen.getByRole('textbox', { name: topKLabel })).toBeEnabled()
  expect(screen.queryByRole('textbox', { name: scoreThresholdLabel })).not.toBeInTheDocument()
  expect(screen.queryByRole('switch')).not.toBeInTheDocument()
})
