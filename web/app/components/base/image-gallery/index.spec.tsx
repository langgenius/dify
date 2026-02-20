import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ImageGallery, { ImageGalleryTest } from '.'

const getImages = (container: HTMLElement) => container.querySelectorAll('img')

describe('ImageGallery', () => {
  describe('Rendering', () => {
    it('should render a single image', () => {
      const { container } = render(<ImageGallery srcs={['https://example.com/img1.png']} />)

      const imgs = getImages(container)
      expect(imgs).toHaveLength(1)
      expect(imgs[0]).toHaveAttribute('src', 'https://example.com/img1.png')
    })

    it('should render multiple images', () => {
      const srcs = ['https://example.com/1.png', 'https://example.com/2.png', 'https://example.com/3.png']
      const { container } = render(<ImageGallery srcs={srcs} />)

      expect(getImages(container)).toHaveLength(3)
    })

    it('should skip falsy src values', () => {
      const srcs = ['https://example.com/1.png', '', 'https://example.com/3.png']
      const { container } = render(<ImageGallery srcs={srcs} />)

      expect(getImages(container)).toHaveLength(2)
    })

    it('should render no images when srcs is empty', () => {
      const { container } = render(<ImageGallery srcs={[]} />)

      expect(getImages(container)).toHaveLength(0)
    })

    it('should not render ImagePreview initially', () => {
      render(<ImageGallery srcs={['https://example.com/img.png']} />)

      expect(screen.queryByTestId('image-preview-container')).not.toBeInTheDocument()
    })
  })

  describe('Width Styles', () => {
    it('should apply maxWidth 100% for a single image', () => {
      const { container } = render(<ImageGallery srcs={['https://example.com/1.png']} />)

      const img = getImages(container)[0]
      expect(img.style.maxWidth).toBe('100%')
    })

    it('should apply calc(50% - 4px) width for 2 images', () => {
      const { container } = render(<ImageGallery srcs={['https://example.com/1.png', 'https://example.com/2.png']} />)

      getImages(container).forEach(img => expect(img.style.width).toBe('calc(50% - 4px)'))
    })

    it('should apply calc(50% - 4px) width for 4 images', () => {
      const srcs = Array.from({ length: 4 }, (_, i) => `https://example.com/${i}.png`)
      const { container } = render(<ImageGallery srcs={srcs} />)

      getImages(container).forEach(img => expect(img.style.width).toBe('calc(50% - 4px)'))
    })

    it('should apply calc(33.3333% - 5.3333px) width for 3 images', () => {
      const srcs = Array.from({ length: 3 }, (_, i) => `https://example.com/${i}.png`)
      const { container } = render(<ImageGallery srcs={srcs} />)

      getImages(container).forEach(img => expect(img.style.width).toBe('calc(33.3333% - 5.3333px)'))
    })

    it('should apply calc(33.3333% - 5.3333px) width for 5 images', () => {
      const srcs = Array.from({ length: 5 }, (_, i) => `https://example.com/${i}.png`)
      const { container } = render(<ImageGallery srcs={srcs} />)

      getImages(container).forEach(img => expect(img.style.width).toBe('calc(33.3333% - 5.3333px)'))
    })

    it('should apply calc(33.3333% - 5.3333px) width for 6 images', () => {
      const srcs = Array.from({ length: 6 }, (_, i) => `https://example.com/${i}.png`)
      const { container } = render(<ImageGallery srcs={srcs} />)

      getImages(container).forEach(img => expect(img.style.width).toBe('calc(33.3333% - 5.3333px)'))
    })
  })

  describe('Image Preview', () => {
    it('should show ImagePreview when an image is clicked', async () => {
      const user = userEvent.setup()
      const { container } = render(<ImageGallery srcs={['https://example.com/img1.png']} />)
      await user.click(getImages(container)[0])

      const previewContainer = screen.queryByTestId('image-preview-container')
      expect(previewContainer).toBeInTheDocument()
      expect(previewContainer?.querySelector('img')).toHaveAttribute('src', 'https://example.com/img1.png')
    })

    it('should show preview for the specific clicked image', async () => {
      const user = userEvent.setup()
      const srcs = ['https://example.com/1.png', 'https://example.com/2.png']
      const { container } = render(<ImageGallery srcs={srcs} />)

      await user.click(getImages(container)[1])

      const previewContainer = screen.queryByTestId('image-preview-container')
      expect(previewContainer?.querySelector('img')).toHaveAttribute('src', 'https://example.com/2.png')
    })

    it('should hide ImagePreview when Escape is pressed', async () => {
      const user = userEvent.setup()
      const { container } = render(<ImageGallery srcs={['https://example.com/img1.png']} />)

      await user.click(getImages(container)[0])
      expect(screen.queryByTestId('image-preview-container')).toBeInTheDocument()

      await user.keyboard('{Escape}')

      await waitFor(() => {
        expect(screen.queryByTestId('image-preview-container')).not.toBeInTheDocument()
      })
    })
  })

  describe('Error Handling', () => {
    it('should remove image element on error', () => {
      const { container } = render(<ImageGallery srcs={['https://example.com/broken.png']} />)

      const img = getImages(container)[0]
      fireEvent.error(img)

      expect(getImages(container)).toHaveLength(0)
    })
  })
})

describe('ImageGalleryTest', () => {
  it('should render multiple ImageGallery instances', () => {
    const { container } = render(<ImageGalleryTest />)

    const imgs = getImages(container)
    // 6 images renders galleries with 1+2+3+4+5+6 = 21 images total
    expect(imgs.length).toBe(21)
  })
})
