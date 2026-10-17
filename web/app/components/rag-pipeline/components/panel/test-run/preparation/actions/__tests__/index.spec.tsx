import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Actions from '../index'

it('only advances while the selected datasource is ready', async () => {
  const user = userEvent.setup()
  const handleNextStep = vi.fn()
  const { rerender } = render(<Actions disabled handleNextStep={handleNextStep} />)
  const next = screen.getByRole('button', { name: 'datasetCreation.stepOne.button' })
  expect(next).toBeDisabled()
  await user.click(next)
  expect(handleNextStep).not.toHaveBeenCalled()

  rerender(<Actions handleNextStep={handleNextStep} />)
  await user.tab()
  expect(next).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(handleNextStep).toHaveBeenCalledOnce()

  rerender(<Actions disabled handleNextStep={handleNextStep} />)
  await user.click(next)
  expect(handleNextStep).toHaveBeenCalledOnce()
})
