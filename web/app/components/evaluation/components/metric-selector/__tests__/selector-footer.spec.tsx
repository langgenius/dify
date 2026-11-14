import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SelectorFooter from '../selector-footer'

const props = {
  title: 'Custom metrics',
  description: 'Connect a published evaluation workflow',
  infoLabel: 'Custom Evaluator',
  infoDescription: 'A custom evaluator uses a published evaluation workflow.',
  createLabel: 'Create workflow',
  createHref: '/apps?create=blank&mode=workflow',
}

it('explains custom evaluators and opens workflow creation separately from adding a metric', async () => {
  const user = userEvent.setup()
  const onClick = vi.fn()
  render(<SelectorFooter {...props} onClick={onClick} />)

  await user.click(screen.getByRole('button', { name: 'Custom Evaluator' }))
  expect(await screen.findByText(props.infoDescription)).toBeInTheDocument()
  expect(onClick).not.toHaveBeenCalled()

  const createLink = screen.getByRole('link', { name: 'Create workflow' })
  expect(createLink).toHaveAttribute('href', props.createHref)
  expect(createLink).toHaveAttribute('target', '_blank')
  expect(createLink).toHaveAttribute('rel', 'noopener noreferrer')

  await user.click(screen.getByRole('button', { name: 'Custom metrics' }))
  expect(onClick).toHaveBeenCalledOnce()
})

it('keeps help and creation available when the custom metric limit disables adding', async () => {
  const user = userEvent.setup()
  const onClick = vi.fn()
  render(<SelectorFooter {...props} disabled onClick={onClick} />)

  expect(screen.getByRole('button', { name: 'Custom metrics' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Custom Evaluator' }))
  expect(await screen.findByText(props.infoDescription)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Create workflow' })).toBeInTheDocument()
  expect(onClick).not.toHaveBeenCalled()
})
