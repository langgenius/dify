import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import ScoreThresholdItem from '../score-threshold-item'

it.each([
  [undefined, '0.7'],
  [-0.1, '0'],
  [1.5, '1'],
  [0.556, '0.56'],
])('normalizes configured threshold %s to %s', (value, expected) => {
  render(<ScoreThresholdItem value={value} enable onChange={vi.fn()} />)
  expect(screen.getByRole('textbox')).toHaveValue(expected)
})

it('edits the score threshold in hundredths and disables its controls when switched off', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  const onSwitchChange = vi.fn()
  function Settings() {
    const [value, setValue] = useState(0.5)
    const [enable, setEnable] = useState(true)
    return (
      <ScoreThresholdItem
        value={value}
        enable={enable}
        hasSwitch
        onChange={(key, next) => {
          onChange(key, next)
          setValue(next)
        }}
        onSwitchChange={(key, next) => {
          onSwitchChange(key, next)
          setEnable(next)
        }}
      />
    )
  }
  render(<Settings />)
  const input = screen.getByRole('textbox')
  await user.click(screen.getByRole('button', { name: /increment/i }))
  expect(input).toHaveValue('0.51')
  expect(onChange).toHaveBeenLastCalledWith('score_threshold', 0.51)
  await user.clear(input)
  await user.type(input, '0.55')
  expect(onChange).toHaveBeenLastCalledWith('score_threshold', 0.55)
  await user.click(screen.getByRole('switch'))
  expect(onSwitchChange).toHaveBeenLastCalledWith('score_threshold', false)
  expect(input).toBeDisabled()
  expect(
    screen.getByLabelText('appDebug.datasetConfig.score_threshold', {
      selector: 'input[type="range"]',
    }),
  ).toBeDisabled()
})
