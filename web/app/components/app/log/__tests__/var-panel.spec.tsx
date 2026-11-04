import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import VarPanel from '../var-panel'

it('collapses and restores variables without exposing an empty image section', async () => {
  const user = userEvent.setup()
  render(<VarPanel varList={[{ label: 'name', value: 'John Doe' }]} message_files={[]} />)
  expect(screen.getByText('name')).toBeInTheDocument()
  expect(screen.getByText('John Doe')).toBeInTheDocument()
  expect(screen.queryByText(/detail\.uploadImages$/)).not.toBeInTheDocument()
  const header = screen.getByText(/detail\.variables$/)
  await user.click(header)
  expect(screen.queryByText('John Doe')).not.toBeInTheDocument()
  await user.click(header)
  expect(screen.getByText('John Doe')).toBeInTheDocument()
})

it('opens the selected attachment in the real image preview and dismisses it', async () => {
  const user = userEvent.setup()
  const urls = ['https://example.com/first.jpg', 'https://example.com/second.jpg']
  const { container } = render(<VarPanel varList={[]} message_files={urls} />)
  // Thumbnails currently have no accessible role or name.
  const thumbnails = container.querySelectorAll<HTMLElement>('[style*="background-image"]')
  await user.click(thumbnails[1]!)
  const preview = await screen.findByRole('dialog', { name: urls[1] })
  expect(within(preview).getByRole('img', { name: urls[1] })).toHaveAttribute('src', urls[1])
  await user.click(within(preview).getByRole('button', { name: /operation\.cancel$/ }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await user.click(thumbnails[0]!)
  expect(await screen.findByRole('dialog', { name: urls[0] })).toBeInTheDocument()
})
