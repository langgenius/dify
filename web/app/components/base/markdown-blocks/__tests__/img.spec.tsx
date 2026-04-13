import { render, screen } from '@testing-library/react'
import { Img } from '..'

describe('Img', () => {
  describe('Rendering', () => {
    it('should render with the correct wrapper class', () => {
      const { container } = render(<Img src="https://example.com/image.png" />)

      const wrapper = container.querySelector('.markdown-img-wrapper')
      expect(wrapper).toBeInTheDocument()
    })

    it('should render ImageGallery with the src as an array', () => {
      render(<Img src="https://example.com/image.png" />)

      const gallery = screen.getByTestId('image-gallery')
      expect(gallery).toBeInTheDocument()

      const images = gallery.querySelectorAll('img')
      expect(images).toHaveLength(1)
      expect(images[0]).toHaveAttribute('src', 'https://example.com/image.png')
    })

    it('should pass src as single element array to ImageGallery', () => {
      const testSrc = 'https://example.com/test-image.jpg'
      render(<Img src={testSrc} />)

      const gallery = screen.getByTestId('image-gallery')
      const images = gallery.querySelectorAll('img')

      expect(images[0]).toHaveAttribute('src', testSrc)
    })

    it('should render with different src values', () => {
      const { rerender } = render(<Img src="https://example.com/first.png" />)
      expect(screen.getByTestId('gallery-image')).toHaveAttribute('src', 'https://example.com/first.png')

      rerender(<Img src="https://example.com/second.jpg" />)
      expect(screen.getByTestId('gallery-image')).toHaveAttribute('src', 'https://example.com/second.jpg')
    })
  })

  describe('Props', () => {
    it('should accept src prop with various URL formats', () => {
      // Test with HTTPS URL
      const { container: container1 } = render(<Img src="https://example.com/image.png" />)
      expect(container1.querySelector('.markdown-img-wrapper')).toBeInTheDocument()

      // Test with HTTP URL
      const { container: container2 } = render(<Img src="http://example.com/image.png" />)
      expect(container2.querySelector('.markdown-img-wrapper')).toBeInTheDocument()

      // Test with data URL
      const { container: container3 } = render(<Img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" />)
      expect(container3.querySelector('.markdown-img-wrapper')).toBeInTheDocument()

      // Test with relative URL
      const { container: container4 } = render(<Img src="/images/photo.jpg" />)
      expect(container4.querySelector('.markdown-img-wrapper')).toBeInTheDocument()
    })

    it('should handle empty string src', () => {
      const { container } = render(<Img src="" />)

      const wrapper = container.querySelector('.markdown-img-wrapper')
      expect(wrapper).toBeInTheDocument()
    })
  })

  describe('Structure', () => {
    it('should have exactly one wrapper div', () => {
      const { container } = render(<Img src="https://example.com/image.png" />)

      const wrappers = container.querySelectorAll('.markdown-img-wrapper')
      expect(wrappers).toHaveLength(1)
    })

    it('should contain ImageGallery component inside wrapper', () => {
      const { container } = render(<Img src="https://example.com/image.png" />)

      const wrapper = container.querySelector('.markdown-img-wrapper')
      const gallery = wrapper?.querySelector('[data-testid="image-gallery"]')
      expect(gallery).toBeInTheDocument()
    })
  })
})
