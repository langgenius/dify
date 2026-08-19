import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ImageGallery from '..'

describe('ImageGallery', () => {
  it('previews the selected image and closes on Escape', async () => {
    const user = userEvent.setup()
    render(
      <ImageGallery srcs={['https://example.com/first.png', 'https://example.com/second.png']} />,
    )

    await user.click(screen.getAllByTestId('gallery-image')[1]!)

    expect(screen.getByTestId('image-preview-container').querySelector('img')).toHaveAttribute(
      'src',
      'https://example.com/second.png',
    )

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByTestId('image-preview-container')).not.toBeInTheDocument()
    })
  })

  it('removes an image that fails to load', () => {
    render(<ImageGallery srcs={['https://example.com/broken.png']} />)

    fireEvent.error(screen.getByTestId('gallery-image'))

    expect(screen.queryByTestId('gallery-image')).not.toBeInTheDocument()
  })
})
