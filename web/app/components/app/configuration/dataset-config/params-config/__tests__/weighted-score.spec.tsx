import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import WeightedScore from '../weighted-score'

it('keeps semantic and keyword weights complementary through changes and endpoint selection', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  function Weights() {
    const [value, setValue] = useState({ value: [0.3, 0.7] })
    return (
      <WeightedScore
        value={value}
        onChange={(next) => {
          setValue(next)
          onChange(next)
        }}
      />
    )
  }
  render(<Weights />)
  const slider = screen.getByRole('slider', { name: 'dataset.weightedScore.semantic' })
  expect(slider).toHaveAttribute(
    'aria-valuetext',
    'dataset.weightedScore.semantic: 0.3, dataset.weightedScore.keyword: 0.7',
  )
  slider.focus()
  await user.keyboard('{ArrowRight}')
  expect(onChange).toHaveBeenLastCalledWith({ value: [0.4, 0.6] })
  expect(slider).toHaveAttribute(
    'aria-valuetext',
    'dataset.weightedScore.semantic: 0.4, dataset.weightedScore.keyword: 0.6',
  )
  await user.keyboard('{End}')
  expect(onChange).toHaveBeenLastCalledWith({ value: [1, 0] })
  expect(screen.getByText('1.0')).toBeInTheDocument()
})

it('keeps readonly weights disabled', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(<WeightedScore value={{ value: [0.5, 0.5] }} onChange={onChange} readonly />)
  const slider = screen.getByRole('slider', { name: 'dataset.weightedScore.semantic' })
  expect(slider).toBeDisabled()
  await user.click(slider)
  expect(onChange).not.toHaveBeenCalled()
})
