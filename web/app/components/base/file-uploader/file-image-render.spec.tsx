import { fireEvent, render, screen } from '@testing-library/react'
import FileImageRender from './file-image-render'

describe('FileImageRender', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render an image with the given URL', () => {
    render(<FileImageRender imageUrl="https://example.com/image.png" />)

    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('src', 'https://example.com/image.png')
  })

  it('should use default alt text when alt is not provided', () => {
    render(<FileImageRender imageUrl="https://example.com/image.png" />)

    expect(screen.getByAltText('Preview')).toBeInTheDocument()
  })

  it('should use custom alt text when provided', () => {
    render(<FileImageRender imageUrl="https://example.com/image.png" alt="Custom alt" />)

    expect(screen.getByAltText('Custom alt')).toBeInTheDocument()
  })

  it('should apply custom className to container', () => {
    const { container } = render(
      <FileImageRender imageUrl="https://example.com/image.png" className="custom-class" />,
    )

    expect(container.firstChild).toHaveClass('custom-class')
  })

  it('should call onLoad when image loads', () => {
    const onLoad = vi.fn()
    render(<FileImageRender imageUrl="https://example.com/image.png" onLoad={onLoad} />)

    fireEvent.load(screen.getByRole('img'))

    expect(onLoad).toHaveBeenCalled()
  })

  it('should call onError when image fails to load', () => {
    const onError = vi.fn()
    render(<FileImageRender imageUrl="https://example.com/broken.png" onError={onError} />)

    fireEvent.error(screen.getByRole('img'))

    expect(onError).toHaveBeenCalled()
  })

  it('should add cursor-pointer to image when showDownloadAction is true', () => {
    render(<FileImageRender imageUrl="https://example.com/image.png" showDownloadAction />)

    const img = screen.getByRole('img')
    expect(img).toHaveClass('cursor-pointer')
  })

  it('should not add cursor-pointer when showDownloadAction is false', () => {
    render(<FileImageRender imageUrl="https://example.com/image.png" />)

    const img = screen.getByRole('img')
    expect(img).not.toHaveClass('cursor-pointer')
  })
})
