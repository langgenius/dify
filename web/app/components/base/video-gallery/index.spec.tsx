import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import VideoGallery from './index'

describe('VideoGallery', () => {
  const mockSrcs = ['video1.mp4', 'video2.mp4']

  it('should render nothing when srcs is empty', () => {
    const { container } = render(<VideoGallery srcs={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('should render nothing when all srcs are empty strings', () => {
    const { container } = render(<VideoGallery srcs={['', '']} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('should render VideoPlayer when valid srcs are provided', () => {
    render(<VideoGallery srcs={mockSrcs} />)
    expect(screen.getByTestId('video-gallery-container')).toBeInTheDocument()
    expect(screen.getByTestId('video-element')).toBeInTheDocument()
  })
})
