import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import KeyWordNumber from '../keyword-number'

it('keeps the slider in sync with the keyword count, including clearing and the configured limit', async () => {
  const user = userEvent.setup()
  const Harness = () => {
    const [count, setCount] = useState(10)
    return <KeyWordNumber keywordNumber={count} onKeywordNumberChange={setCount} />
  }
  render(<Harness />)
  const input = screen.getByRole('textbox', { name: 'datasetSettings.form.numberOfKeywords' })
  const slider = screen.getByLabelText('datasetSettings.form.numberOfKeywords', {
    selector: 'input[type="range"]',
  })
  await user.clear(input)
  await user.tab()
  expect(input).toHaveValue('0')
  expect(slider).toHaveAttribute('aria-valuenow', '0')
  await user.clear(input)
  await user.type(input, '30')
  await user.tab()
  expect(slider).toHaveAttribute('aria-valuenow', '30')
  await user.clear(input)
  await user.type(input, '60')
  await user.tab()
  expect(input).toHaveValue('50')
  expect(slider).toHaveAttribute('aria-valuenow', '50')
})

it('locks both keyword controls when editing is disabled', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(<KeyWordNumber keywordNumber={10} onKeywordNumberChange={onChange} disabled />)
  const input = screen.getByRole('textbox', { name: 'datasetSettings.form.numberOfKeywords' })
  expect(input).toBeDisabled()
  expect(
    screen.getByLabelText('datasetSettings.form.numberOfKeywords', {
      selector: 'input[type="range"]',
    }),
  ).toBeDisabled()
  await user.type(input, '20')
  expect(onChange).not.toHaveBeenCalled()
})
