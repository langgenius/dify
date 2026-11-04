import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CopyFeedback } from '..'

it('copies content and keeps the success feedback available after clicking', async () => {
  const user = userEvent.setup()
  render(<CopyFeedback content="test content" />)
  const button = screen.getByRole('button', { name: 'common.operation.copy' })
  await user.hover(button)
  expect(await screen.findByText('common.operation.copy')).toBeInTheDocument()
  await user.click(button)

  expect(await navigator.clipboard.readText()).toBe('test content')
  expect(await screen.findByRole('button', { name: 'common.operation.copied' })).toBeInTheDocument()
  expect(await screen.findByText('common.operation.copied')).toBeInTheDocument()
})
