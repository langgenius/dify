import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from '@/app/notifications'
import { CrawlStep } from '@/models/datasets'
import { createPipelineVariable } from '@/test/pipeline-variables'
import Options from '../index'

vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))
const variables = [
  createPipelineVariable({ variable: 'url', label: 'URL', default_value: 'https://example.com' }),
]
const runName = 'datasetCreation.stepOne.website.run'

it('rejects an empty required field and runs with the corrected URL', async () => {
  const user = userEvent.setup()
  const onSubmit = vi.fn()
  render(<Options variables={variables} step={CrawlStep.init} onSubmit={onSubmit} />)
  const input = screen.getByRole('textbox', { name: /URL/ })
  expect(input).toHaveValue('https://example.com')
  await user.clear(input)
  await user.click(screen.getByRole('button', { name: runName }))
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith('"url" URL is required'))
  expect(onSubmit).not.toHaveBeenCalled()
  await user.type(input, 'https://example.com/docs')
  await user.click(screen.getByRole('button', { name: runName }))
  await waitFor(() =>
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ url: 'https://example.com/docs' }),
  )
})

it('preserves edited options across crawling and reopens them for another run', async () => {
  const user = userEvent.setup()
  const props = { variables, onSubmit: vi.fn() }
  const { rerender } = render(<Options {...props} step={CrawlStep.init} />)
  const input = screen.getByRole('textbox', { name: /URL/ })
  await user.clear(input)
  await user.type(input, 'https://example.com/changed')
  rerender(<Options {...props} step={CrawlStep.running} />)
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'datasetCreation.stepOne.website.running' }))
  expect(props.onSubmit).not.toHaveBeenCalled()
  rerender(<Options {...props} step={CrawlStep.finished} />)
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  rerender(<Options {...props} step={CrawlStep.init} />)
  expect(screen.getByRole('textbox', { name: /URL/ })).toHaveValue('https://example.com/changed')
})

it('does not start a crawl when the caller disables running', async () => {
  const user = userEvent.setup()
  const onSubmit = vi.fn()
  render(<Options variables={variables} step={CrawlStep.init} onSubmit={onSubmit} runDisabled />)
  await user.click(screen.getByRole('button', { name: runName }))
  expect(onSubmit).not.toHaveBeenCalled()
})
