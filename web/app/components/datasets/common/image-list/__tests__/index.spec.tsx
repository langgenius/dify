import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { mockFixtureImageFetch } from '@/test/image-fetch'
import ImageList from '../index'

const images = Array.from({ length: 3 }, (_, index) => ({
  name: `image-${index + 1}.png`,
  mimeType: 'image/png',
  size: 1024,
  extension: 'png',
  sourceUrl: `data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7#${index}`,
}))

it('expands hidden attachments and opens the selected image in the actual preview', async () => {
  const user = userEvent.setup()
  render(<ImageList images={images} size="md" limit={2} />)
  expect(screen.queryByRole('button', { name: 'image-3.png' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '+1' }))
  expect(screen.queryByRole('button', { name: '+1' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'image-3.png' }))
  const dialog = await screen.findByRole('dialog', { name: 'image-3.png' })
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.close' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByRole('button', { name: 'image-3.png' })).toBeInTheDocument()
})

beforeEach(() => mockFixtureImageFetch())
