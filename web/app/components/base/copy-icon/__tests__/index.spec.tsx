import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CopyIcon from '..'

it('copies the supplied embed content and resets feedback when the pointer leaves', async () => {
  const user = userEvent.setup()
  render(<CopyIcon content="Embed this app" />)
  const button = screen.getByRole('button', { name: 'common.operation.copy' })
  await user.click(button)
  expect(await navigator.clipboard.readText()).toBe('Embed this app')
  expect(await screen.findByRole('button', { name: 'common.operation.copied' })).toBeInTheDocument()

  await user.unhover(button)
  expect(screen.getByRole('button', { name: 'common.operation.copy' })).toBeInTheDocument()
})
