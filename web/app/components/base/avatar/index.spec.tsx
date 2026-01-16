import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import Avatar from './index'

describe('Avatar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering tests - verify component renders correctly in different states
  describe('Rendering', () => {
    it('should render img element with correct alt and src when avatar URL is provided', () => {
      const avatarUrl = 'https://example.com/avatar.jpg'
      const props = { name: 'John Doe', avatar: avatarUrl }

      render(<Avatar {...props} />)

      const img = screen.getByRole('img', { name: 'John Doe' })
      expect(img).toBeInTheDocument()
      expect(img).toHaveAttribute('src', avatarUrl)
    })

    it('should render fallback div with uppercase initial when avatar is null', () => {
      const props = { name: 'alice', avatar: null }

      render(<Avatar {...props} />)

      expect(screen.queryByRole('img')).not.toBeInTheDocument()
      expect(screen.getByText('A')).toBeInTheDocument()
    })
  })

  // Props tests - verify all props are applied correctly
  describe('Props', () => {
    describe('size prop', () => {
      it.each([
        { size: undefined, expected: '30px', label: 'default (30px)' },
        { size: 50, expected: '50px', label: 'custom (50px)' },
      ])('should apply $label size to img element', ({ size, expected }) => {
        const props = { name: 'Test', avatar: 'https://example.com/avatar.jpg', size }

        render(<Avatar {...props} />)

        expect(screen.getByRole('img')).toHaveStyle({
          width: expected,
          height: expected,
          fontSize: expected,
          lineHeight: expected,
        })
      })

      it('should apply size to fallback div when avatar is null', () => {
        const props = { name: 'Test', avatar: null, size: 40 }

        render(<Avatar {...props} />)

        const textElement = screen.getByText('T')
        const outerDiv = textElement.parentElement as HTMLElement
        expect(outerDiv).toHaveStyle({ width: '40px', height: '40px' })
      })
    })

    describe('className prop', () => {
      it('should merge className with default avatar classes on img', () => {
        const props = {
          name: 'Test',
          avatar: 'https://example.com/avatar.jpg',
          className: 'custom-class',
        }

        render(<Avatar {...props} />)

        const img = screen.getByRole('img')
        expect(img).toHaveClass('custom-class')
        expect(img).toHaveClass('shrink-0', 'flex', 'items-center', 'rounded-full', 'bg-primary-600')
      })

      it('should merge className with default avatar classes on fallback div', () => {
        const props = {
          name: 'Test',
          avatar: null,
          className: 'my-custom-class',
        }

        render(<Avatar {...props} />)

        const textElement = screen.getByText('T')
        const outerDiv = textElement.parentElement as HTMLElement
        expect(outerDiv).toHaveClass('my-custom-class')
        expect(outerDiv).toHaveClass('shrink-0', 'flex', 'items-center', 'rounded-full', 'bg-primary-600')
      })
    })

    describe('textClassName prop', () => {
      it('should apply textClassName to the initial text element', () => {
        const props = {
          name: 'Test',
          avatar: null,
          textClassName: 'custom-text-class',
        }

        render(<Avatar {...props} />)

        const textElement = screen.getByText('T')
        expect(textElement).toHaveClass('custom-text-class')
        expect(textElement).toHaveClass('scale-[0.4]', 'text-center', 'text-white')
      })
    })
  })

  // State Management tests - verify useState and useEffect behavior
  describe('State Management', () => {
    it('should switch to fallback when image fails to load', async () => {
      const props = { name: 'John', avatar: 'https://example.com/broken.jpg' }
      render(<Avatar {...props} />)
      const img = screen.getByRole('img')

      fireEvent.error(img)

      await waitFor(() => {
        expect(screen.queryByRole('img')).not.toBeInTheDocument()
      })
      expect(screen.getByText('J')).toBeInTheDocument()
    })

    it('should reset error state when avatar URL changes', async () => {
      const initialProps = { name: 'John', avatar: 'https://example.com/broken.jpg' }
      const { rerender } = render(<Avatar {...initialProps} />)
      const img = screen.getByRole('img')

      // First, trigger error
      fireEvent.error(img)
      await waitFor(() => {
        expect(screen.queryByRole('img')).not.toBeInTheDocument()
      })
      expect(screen.getByText('J')).toBeInTheDocument()

      rerender(<Avatar name="John" avatar="https://example.com/new-avatar.jpg" />)

      await waitFor(() => {
        expect(screen.getByRole('img')).toBeInTheDocument()
      })
      expect(screen.queryByText('J')).not.toBeInTheDocument()
    })

    it('should not reset error state if avatar becomes null', async () => {
      const initialProps = { name: 'John', avatar: 'https://example.com/broken.jpg' }
      const { rerender } = render(<Avatar {...initialProps} />)

      // Trigger error
      fireEvent.error(screen.getByRole('img'))
      await waitFor(() => {
        expect(screen.getByText('J')).toBeInTheDocument()
      })

      rerender(<Avatar name="John" avatar={null} />)

      await waitFor(() => {
        expect(screen.queryByRole('img')).not.toBeInTheDocument()
      })
      expect(screen.getByText('J')).toBeInTheDocument()
    })
  })

  // Event Handlers tests - verify onError callback behavior
  describe('Event Handlers', () => {
    it('should call onError with true when image fails to load', () => {
      const onErrorMock = vi.fn()
      const props = {
        name: 'John',
        avatar: 'https://example.com/broken.jpg',
        onError: onErrorMock,
      }
      render(<Avatar {...props} />)

      fireEvent.error(screen.getByRole('img'))

      expect(onErrorMock).toHaveBeenCalledTimes(1)
      expect(onErrorMock).toHaveBeenCalledWith(true)
    })

    it('should call onError with false when image loads successfully', () => {
      const onErrorMock = vi.fn()
      const props = {
        name: 'John',
        avatar: 'https://example.com/avatar.jpg',
        onError: onErrorMock,
      }
      render(<Avatar {...props} />)

      fireEvent.load(screen.getByRole('img'))

      expect(onErrorMock).toHaveBeenCalledTimes(1)
      expect(onErrorMock).toHaveBeenCalledWith(false)
    })

    it('should not throw when onError is not provided', async () => {
      const props = { name: 'John', avatar: 'https://example.com/broken.jpg' }
      render(<Avatar {...props} />)

      expect(() => fireEvent.error(screen.getByRole('img'))).not.toThrow()
      await waitFor(() => {
        expect(screen.getByText('J')).toBeInTheDocument()
      })
    })
  })

  // Edge Cases tests - verify handling of unusual inputs
  describe('Edge Cases', () => {
    it('should handle empty string name gracefully', () => {
      const props = { name: '', avatar: null }

      const { container } = render(<Avatar {...props} />)

      // Note: Using querySelector here because empty name produces no visible text,
      // making semantic queries (getByRole, getByText) impossible
      const textElement = container.querySelector('.text-white') as HTMLElement
      expect(textElement).toBeInTheDocument()
      expect(textElement.textContent).toBe('')
    })

    it.each([
      { name: '中文名', expected: '中', label: 'Chinese characters' },
      { name: '123User', expected: '1', label: 'number' },
    ])('should display first character when name starts with $label', ({ name, expected }) => {
      const props = { name, avatar: null }

      render(<Avatar {...props} />)

      expect(screen.getByText(expected)).toBeInTheDocument()
    })

    it('should handle empty string avatar as falsy value', () => {
      const props = { name: 'Test', avatar: '' as string | null }

      render(<Avatar {...props} />)

      expect(screen.queryByRole('img')).not.toBeInTheDocument()
      expect(screen.getByText('T')).toBeInTheDocument()
    })

    it('should handle undefined className and textClassName', () => {
      const props = { name: 'Test', avatar: null }

      render(<Avatar {...props} />)

      const textElement = screen.getByText('T')
      const outerDiv = textElement.parentElement as HTMLElement
      expect(outerDiv).toHaveClass('shrink-0', 'flex', 'items-center', 'rounded-full', 'bg-primary-600')
    })

    it.each([
      { size: 0, expected: '0px', label: 'zero' },
      { size: 1000, expected: '1000px', label: 'very large' },
    ])('should handle $label size value', ({ size, expected }) => {
      const props = { name: 'Test', avatar: null, size }

      render(<Avatar {...props} />)

      const textElement = screen.getByText('T')
      const outerDiv = textElement.parentElement as HTMLElement
      expect(outerDiv).toHaveStyle({ width: expected, height: expected })
    })
  })

  // Combined props tests - verify props work together correctly
  describe('Combined Props', () => {
    it('should apply all props correctly when used together', () => {
      const onErrorMock = vi.fn()
      const props = {
        name: 'Test User',
        avatar: 'https://example.com/avatar.jpg',
        size: 64,
        className: 'custom-avatar',
        onError: onErrorMock,
      }

      render(<Avatar {...props} />)

      const img = screen.getByRole('img')
      expect(img).toHaveAttribute('alt', 'Test User')
      expect(img).toHaveAttribute('src', 'https://example.com/avatar.jpg')
      expect(img).toHaveStyle({ width: '64px', height: '64px' })
      expect(img).toHaveClass('custom-avatar')

      // Trigger load to verify onError callback
      fireEvent.load(img)
      expect(onErrorMock).toHaveBeenCalledWith(false)
    })

    it('should apply all fallback props correctly when used together', () => {
      const props = {
        name: 'Fallback User',
        avatar: null,
        size: 48,
        className: 'fallback-custom',
        textClassName: 'custom-text-style',
      }

      render(<Avatar {...props} />)

      const textElement = screen.getByText('F')
      const outerDiv = textElement.parentElement as HTMLElement
      expect(outerDiv).toHaveClass('fallback-custom')
      expect(outerDiv).toHaveStyle({ width: '48px', height: '48px' })
      expect(textElement).toHaveClass('custom-text-style')
    })
  })
})
