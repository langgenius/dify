/* eslint-disable next/no-img-element */
import type { ImgHTMLAttributes } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FileThumb from './index'

vi.mock('next/image', () => ({
  __esModule: true,
  default: (props: ImgHTMLAttributes<HTMLImageElement>) => <img {...props} />,
}))

describe('FileThumb Component', () => {
  const mockImageFile = {
    name: 'test-image.jpg',
    mimeType: 'image/jpeg',
    extension: '.jpg',
    size: 1024,
    sourceUrl: 'https://example.com/test-image.jpg',
  }

  const mockNonImageFile = {
    name: 'test.pdf',
    mimeType: 'application/pdf',
    extension: '.pdf',
    size: 2048,
    sourceUrl: 'https://example.com/test.pdf',
  }

  describe('Render', () => {
    it('renders image thumbnail correctly', () => {
      render(<FileThumb file={mockImageFile} />)

      const img = screen.getByAltText(mockImageFile.name)
      expect(img).toBeInTheDocument()
      expect(img).toHaveAttribute('src', mockImageFile.sourceUrl)
    })

    it('renders file type icon for non-image files', () => {
      const { container } = render(<FileThumb file={mockNonImageFile} />)

      expect(screen.queryByAltText(mockNonImageFile.name)).not.toBeInTheDocument()
      const svgIcon = container.querySelector('svg')
      expect(svgIcon).toBeInTheDocument()
    })

    it('wraps content inside tooltip', async () => {
      const user = userEvent.setup()
      render(<FileThumb file={mockImageFile} />)

      const trigger = screen.getByAltText(mockImageFile.name)
      expect(trigger).toBeInTheDocument()

      await user.hover(trigger)

      const tooltipContent = await screen.findByText(mockImageFile.name)
      expect(tooltipContent).toBeInTheDocument()
    })
  })

  describe('Interaction', () => {
    it('calls onClick with file when clicked', () => {
      const onClick = vi.fn()

      render(<FileThumb file={mockImageFile} onClick={onClick} />)

      const clickable = screen.getByAltText(mockImageFile.name).closest('div') as HTMLElement

      fireEvent.click(clickable)

      expect(onClick).toHaveBeenCalledTimes(1)
      expect(onClick).toHaveBeenCalledWith(mockImageFile)
    })
  })
})
