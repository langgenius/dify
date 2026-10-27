import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import UrlInput from '../url-input'

it('runs the entered URL, prevents another run while pending and preserves the URL for retry', async () => {
  const user = userEvent.setup()
  const onRun = vi.fn()
  const { rerender } = render(<UrlInput isRunning={false} onRun={onRun} />)
  const url = 'https://example.com/docs?lang=en&version=2'
  await user.type(screen.getByRole('textbox'), url)
  await user.click(screen.getByRole('button', { name: 'datasetCreation.stepOne.website.run' }))
  expect(onRun).toHaveBeenCalledWith(url)
  rerender(<UrlInput isRunning onRun={onRun} />)
  const run = screen.getByRole('button', { name: 'datasetCreation.stepOne.website.run' })
  expect(run).toHaveAttribute('aria-disabled', 'true')
  await user.click(run)
  expect(onRun).toHaveBeenCalledOnce()
  rerender(<UrlInput isRunning={false} onRun={onRun} />)
  expect(screen.getByRole('textbox')).toHaveValue(url)
  await user.click(screen.getByRole('button', { name: 'datasetCreation.stepOne.website.run' }))
  expect(onRun).toHaveBeenLastCalledWith(url)
  expect(onRun).toHaveBeenCalledTimes(2)
})
