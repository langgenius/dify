import { render } from 'vitest-browser-react'
import { Avatar, AvatarFallback, AvatarImage, AvatarRoot } from '..'

function stubImageLoader() {
  const originalImage = window.Image
  const images: HTMLImageElement[] = []

  function TestImage(_width?: number, _height?: number): HTMLImageElement {
    const image = document.createElement('img')
    images.push(image)
    return image
  }

  Object.defineProperty(window, 'Image', {
    configurable: true,
    value: TestImage,
    writable: true,
  })

  return {
    images,
    restore: () => {
      window.Image = originalImage
    },
  }
}

describe('Avatar', () => {
  describe('Rendering', () => {
    it('should keep the fallback visible when avatar URL is provided before image load', async () => {
      const screen = await render(
        <Avatar name="John Doe" avatar="https://example.com/avatar.jpg" />,
      )

      await expect.element(screen.getByText('J')).toBeInTheDocument()
    })

    it('should render fallback with uppercase initial when avatar is null', async () => {
      const screen = await render(<Avatar name="alice" avatar={null} />)

      expect(screen.container.querySelector('img')).not.toBeInTheDocument()
      await expect.element(screen.getByText('A')).toBeInTheDocument()
    })

    it('should render the fallback when avatar is provided', async () => {
      const screen = await render(<Avatar name="John" avatar="https://example.com/avatar.jpg" />)

      await expect.element(screen.getByText('J')).toBeInTheDocument()
    })
  })

  describe('className prop', () => {
    it('should merge className with avatar variant classes on root', async () => {
      const screen = await render(<Avatar name="Test" avatar={null} className="custom-class" />)

      const root = screen.container.firstElementChild as HTMLElement
      expect(root).toHaveClass('custom-class')
    })
  })

  describe('Primitives', () => {
    it('should support composed avatar usage through exported primitives', async () => {
      const screen = await render(
        <AvatarRoot size="sm" data-testid="avatar-root">
          <AvatarImage src="https://example.com/avatar.jpg" alt="Jane Doe" />
          <AvatarFallback size="sm" style={{ backgroundColor: 'rgb(1, 2, 3)' }}>
            J
          </AvatarFallback>
        </AvatarRoot>,
      )

      await expect.element(screen.getByTestId('avatar-root')).toBeInTheDocument()
      await expect.element(screen.getByText('J')).toBeInTheDocument()
      await expect.element(screen.getByText('J')).toHaveStyle({ backgroundColor: 'rgb(1, 2, 3)' })
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty string name gracefully', async () => {
      const screen = await render(<Avatar name="" avatar={null} />)

      expect(screen.container.firstElementChild).toBeInTheDocument()
      expect(screen.container.textContent).toBe('')
    })

    it.each([
      { name: '中文名', expected: '中', label: 'Chinese characters' },
      { name: '123User', expected: '1', label: 'number' },
    ])(
      'should display first character when name starts with $label',
      async ({ name, expected }) => {
        const screen = await render(<Avatar name={name} avatar={null} />)

        await expect.element(screen.getByText(expected)).toBeInTheDocument()
      },
    )

    it('should handle empty string avatar as falsy value', async () => {
      const screen = await render(<Avatar name="Test" avatar="" />)

      expect(screen.container.querySelector('img')).not.toBeInTheDocument()
      await expect.element(screen.getByText('T')).toBeInTheDocument()
    })
  })

  describe('onLoadingStatusChange', () => {
    it('should forward image loading status changes', async () => {
      const { images, restore } = stubImageLoader()
      const onStatusChange = vi.fn()

      try {
        await render(
          <Avatar
            name="John"
            avatar="https://example.com/avatar.jpg"
            onLoadingStatusChange={onStatusChange}
          />,
        )

        await vi.waitFor(() => {
          expect(onStatusChange).toHaveBeenCalledWith('loading')
        })

        images[0]?.onload?.(new Event('load'))

        await vi.waitFor(() => {
          expect(onStatusChange).toHaveBeenCalledWith('loaded')
        })
      } finally {
        restore()
      }
    })
  })
})
