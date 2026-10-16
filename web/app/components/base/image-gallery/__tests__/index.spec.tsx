import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createReactI18nextMock } from '@/test/i18n-mock'
import ImageGallery from '..'

vi.mock('react-i18next', () =>
  createReactI18nextMock({
    'imageGallery.previewImage': 'Preview image {{index}} of {{total}}',
  }),
)

describe('ImageGallery', () => {
  it('notifies the embedding owner while a preview is open, including unmount cleanup', async () => {
    const user = userEvent.setup()
    const onPreviewOpenChange = vi.fn()
    const { unmount } = render(
      <ImageGallery
        srcs={['https://example.com/image.png']}
        onPreviewOpenChange={onPreviewOpenChange}
      />,
    )

    expect(onPreviewOpenChange).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Preview image 1 of 1' }))
    expect(onPreviewOpenChange).toHaveBeenLastCalledWith(true)

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(onPreviewOpenChange).toHaveBeenLastCalledWith(false)

    await user.click(screen.getByRole('button', { name: 'Preview image 1 of 1' }))
    expect(onPreviewOpenChange).toHaveBeenLastCalledWith(true)
    unmount()
    expect(onPreviewOpenChange).toHaveBeenLastCalledWith(false)
  })

  it('previews the selected image and closes on Escape', async () => {
    const user = userEvent.setup()
    render(
      <ImageGallery srcs={['https://example.com/first.png', 'https://example.com/second.png']} />,
    )

    await user.click(screen.getByRole('button', { name: 'Preview image 2 of 2' }))

    expect(screen.getByTestId('image-preview-container').querySelector('img')).toHaveAttribute(
      'src',
      'https://example.com/second.png',
    )

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByTestId('image-preview-container')).not.toBeInTheDocument()
    })
  })

  it('releases and restores the embedding owner across page navigation', async () => {
    const user = userEvent.setup()
    const onPreviewOpenChange = vi.fn()
    render(
      <ImageGallery
        srcs={['https://example.com/image.png']}
        onPreviewOpenChange={onPreviewOpenChange}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Preview image 1 of 1' }))

    fireEvent(window, new Event('pagehide'))
    expect(onPreviewOpenChange).toHaveBeenLastCalledWith(false)

    fireEvent(window, new Event('pageshow'))
    expect(onPreviewOpenChange).toHaveBeenLastCalledWith(true)

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    onPreviewOpenChange.mockClear()
    fireEvent(window, new Event('pageshow'))
    expect(onPreviewOpenChange).not.toHaveBeenCalled()
  })

  it('removes an image that fails to load', () => {
    render(<ImageGallery srcs={['https://example.com/broken.png']} />)

    fireEvent.error(screen.getByTestId('gallery-image'))

    expect(screen.queryByTestId('gallery-image')).not.toBeInTheDocument()
  })
})
