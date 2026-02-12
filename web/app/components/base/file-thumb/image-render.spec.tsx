import { render, screen } from '@testing-library/react'
import ImageRender from './image-render'

describe('ImageRender Component', () => {
  const mockProps = {
    sourceUrl: 'https://example.com/image.jpg',
    name: 'test-image.jpg',
  }

  describe('Render', () => {
    it('renders image with correct src and alt', () => {
      render(<ImageRender {...mockProps} />)

      const img = screen.getByRole('img')
      expect(img).toBeInTheDocument()
      expect(img).toHaveAttribute('src', mockProps.sourceUrl)
      expect(img).toHaveAttribute('alt', mockProps.name)
    })
  })
})
