import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import TopKItem from '../top-k-item'

vi.mock('@/env', () => ({ env: { NEXT_PUBLIC_TOP_K_MAX_VALUE: 10 } }))

it('keeps the numeric field and slider synchronized within the configured top-k bounds', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  function Harness() {
    const [value, setValue] = useState(2)
    return (
      <TopKItem
        enable
        value={value}
        onChange={(key, next) => {
          onChange(key, next)
          setValue(next)
        }}
      />
    )
  }
  render(<Harness />)
  const input = screen.getByRole('textbox', { name: 'appDebug.datasetConfig.top_k' })
  const slider = screen.getByLabelText('appDebug.datasetConfig.top_k', {
    selector: 'input[type="range"]',
  })
  await user.click(screen.getByRole('button', { name: /increment/i }))
  expect(input).toHaveValue('3')
  expect(slider).toHaveValue('3')
  slider.focus()
  await user.keyboard('{End}{ArrowRight}')
  expect(input).toHaveValue('10')
  expect(onChange).toHaveBeenLastCalledWith('top_k', 10)
  await user.keyboard('{Home}{ArrowLeft}')
  expect(input).toHaveValue('1')
  expect(onChange).toHaveBeenLastCalledWith('top_k', 1)
})

it.each([
  { enable: false, disabled: false },
  { enable: true, disabled: true },
])('prevents edits with %j', async (props) => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(<TopKItem {...props} value={2} onChange={onChange} />)
  const input = screen.getByRole('textbox', { name: 'appDebug.datasetConfig.top_k' })
  expect(input).toBeDisabled()
  expect(
    screen.getByLabelText('appDebug.datasetConfig.top_k', { selector: 'input[type="range"]' }),
  ).toBeDisabled()
  await user.type(input, '9')
  expect(onChange).not.toHaveBeenCalled()
})
