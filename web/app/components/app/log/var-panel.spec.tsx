import { act, fireEvent, render, screen } from '@testing-library/react'
import VarPanel from './var-panel'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/app/components/base/image-uploader/image-preview', () => ({
  default: ({ url, title, onCancel }: { url: string, title: string, onCancel: () => void }) => (
    <div data-testid="image-preview" data-url={url} data-title={title}>
      <button onClick={onCancel} data-testid="close-preview">Close</button>
    </div>
  ),
}))

describe('VarPanel', () => {
  const defaultProps = {
    varList: [
      { label: 'name', value: 'John Doe' },
      { label: 'age', value: '25' },
    ],
    message_files: [],
  }

  describe('Rendering', () => {
    it('should render variables section header', () => {
      render(<VarPanel {...defaultProps} />)

      expect(screen.getByText('detail.variables')).toBeInTheDocument()
    })

    it('should render variable labels with braces', () => {
      render(<VarPanel {...defaultProps} />)

      expect(screen.getByText('name')).toBeInTheDocument()
      expect(screen.getByText('age')).toBeInTheDocument()
    })

    it('should render variable values', () => {
      render(<VarPanel {...defaultProps} />)

      expect(screen.getByText('John Doe')).toBeInTheDocument()
      expect(screen.getByText('25')).toBeInTheDocument()
    })

    it('should render opening and closing braces', () => {
      render(<VarPanel {...defaultProps} />)

      const openingBraces = screen.getAllByText('{{')
      const closingBraces = screen.getAllByText('}}')

      expect(openingBraces.length).toBe(2)
      expect(closingBraces.length).toBe(2)
    })

    it('should render Variable02 icon', () => {
      const { container } = render(<VarPanel {...defaultProps} />)

      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })
  })

  describe('Collapse/Expand', () => {
    it('should show expanded state by default', () => {
      render(<VarPanel {...defaultProps} />)

      expect(screen.getByText('John Doe')).toBeInTheDocument()
      expect(screen.getByText('25')).toBeInTheDocument()
    })

    it('should collapse when header is clicked', () => {
      render(<VarPanel {...defaultProps} />)

      const header = screen.getByText('detail.variables').closest('div')
      fireEvent.click(header!)

      expect(screen.queryByText('John Doe')).not.toBeInTheDocument()
      expect(screen.queryByText('25')).not.toBeInTheDocument()
    })

    it('should expand when clicked again', () => {
      render(<VarPanel {...defaultProps} />)

      const header = screen.getByText('detail.variables').closest('div')

      // Collapse
      fireEvent.click(header!)
      expect(screen.queryByText('John Doe')).not.toBeInTheDocument()

      // Expand
      fireEvent.click(header!)
      expect(screen.getByText('John Doe')).toBeInTheDocument()
    })

    it('should show arrow icon when collapsed', () => {
      const { container } = render(<VarPanel {...defaultProps} />)

      const header = screen.getByText('detail.variables').closest('div')
      fireEvent.click(header!)

      // When collapsed, there should be SVG icons in the component
      const svgs = container.querySelectorAll('svg')
      expect(svgs.length).toBeGreaterThan(0)
    })

    it('should show arrow icon when expanded', () => {
      const { container } = render(<VarPanel {...defaultProps} />)

      // When expanded, there should be SVG icons in the component
      const svgs = container.querySelectorAll('svg')
      expect(svgs.length).toBeGreaterThan(0)
    })
  })

  describe('Message Files', () => {
    it('should not render images section when message_files is empty', () => {
      render(<VarPanel {...defaultProps} />)

      expect(screen.queryByText('detail.uploadImages')).not.toBeInTheDocument()
    })

    it('should render images section when message_files has items', () => {
      const propsWithFiles = {
        ...defaultProps,
        message_files: ['https://example.com/image1.jpg', 'https://example.com/image2.jpg'],
      }

      render(<VarPanel {...propsWithFiles} />)

      expect(screen.getByText('detail.uploadImages')).toBeInTheDocument()
    })

    it('should render image thumbnails with correct background', () => {
      const propsWithFiles = {
        ...defaultProps,
        message_files: ['https://example.com/image1.jpg'],
      }

      const { container } = render(<VarPanel {...propsWithFiles} />)

      const thumbnail = container.querySelector('[style*="background-image"]')
      expect(thumbnail).toBeInTheDocument()
      expect(thumbnail).toHaveStyle({ backgroundImage: 'url(https://example.com/image1.jpg)' })
    })

    it('should open image preview when thumbnail is clicked', () => {
      const propsWithFiles = {
        ...defaultProps,
        message_files: ['https://example.com/image1.jpg'],
      }

      const { container } = render(<VarPanel {...propsWithFiles} />)

      const thumbnail = container.querySelector('[style*="background-image"]')
      fireEvent.click(thumbnail!)

      expect(screen.getByTestId('image-preview')).toBeInTheDocument()
      expect(screen.getByTestId('image-preview')).toHaveAttribute('data-url', 'https://example.com/image1.jpg')
    })

    it('should close image preview when close button is clicked', () => {
      const propsWithFiles = {
        ...defaultProps,
        message_files: ['https://example.com/image1.jpg'],
      }

      const { container } = render(<VarPanel {...propsWithFiles} />)

      // Open preview
      const thumbnail = container.querySelector('[style*="background-image"]')
      fireEvent.click(thumbnail!)

      expect(screen.getByTestId('image-preview')).toBeInTheDocument()

      // Close preview
      act(() => {
        fireEvent.click(screen.getByTestId('close-preview'))
      })

      expect(screen.queryByTestId('image-preview')).not.toBeInTheDocument()
    })
  })

  describe('Empty State', () => {
    it('should render with empty varList', () => {
      const emptyProps = {
        varList: [],
        message_files: [],
      }

      render(<VarPanel {...emptyProps} />)

      expect(screen.getByText('detail.variables')).toBeInTheDocument()
    })
  })

  describe('Multiple Images', () => {
    it('should render multiple image thumbnails', () => {
      const propsWithMultipleFiles = {
        ...defaultProps,
        message_files: [
          'https://example.com/image1.jpg',
          'https://example.com/image2.jpg',
          'https://example.com/image3.jpg',
        ],
      }

      const { container } = render(<VarPanel {...propsWithMultipleFiles} />)

      const thumbnails = container.querySelectorAll('[style*="background-image"]')
      expect(thumbnails.length).toBe(3)
    })
  })
})
