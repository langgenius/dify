import { render, screen } from '@testing-library/react'
import MediaFilePreview from '../media-file-preview'

describe('MediaFilePreview', () => {
  it('should render an unavailable state when the source is missing', () => {
    render(<MediaFilePreview type="image" src="" />)

    expect(screen.getByText('workflow.skillEditor.previewUnavailable')).toBeInTheDocument()
  })

  it('should render an image preview when the type is image', () => {
    const { container } = render(<MediaFilePreview type="image" src="https://example.com/image.png" />)

    expect(container.querySelector('img')).toHaveAttribute('src', 'https://example.com/image.png')
  })

  it('should render a video preview when the type is video', () => {
    const { container } = render(<MediaFilePreview type="video" src="https://example.com/video.mp4" />)

    expect(container.querySelector('video')).toHaveAttribute('src', 'https://example.com/video.mp4')
  })
})
