import { render } from 'vitest-browser-react'
import { Avatar } from '..'

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
    it('should render fallback with uppercase initial when avatar is null', async () => {
      const screen = await render(<Avatar name="alice" avatar={null} />)

      expect(screen.container.querySelector('img')).not.toBeInTheDocument()
      await expect.element(screen.getByText('A')).toBeInTheDocument()
    })
  })

  describe('className prop', () => {
    it('should merge className with avatar variant classes on root', async () => {
      const screen = await render(<Avatar name="Test" avatar={null} className="custom-class" />)

      const root = screen.container.firstElementChild as HTMLElement
      expect(root).toHaveClass('custom-class')
    })
  })

  describe('onLoadingStatusChange', () => {
    it('should show fallback until the image loads and forward status changes', async () => {
      const { images, restore } = stubImageLoader()
      const onStatusChange = vi.fn()

      try {
        const screen = await render(
          <Avatar
            name="John"
            avatar="https://example.com/avatar.jpg"
            onLoadingStatusChange={onStatusChange}
          />,
        )

        await expect.element(screen.getByText('J')).toBeVisible()
        await vi.waitFor(() => {
          expect(onStatusChange).toHaveBeenCalledWith('loading')
        })

        images[0]?.onload?.(new Event('load'))

        await vi.waitFor(() => {
          expect(onStatusChange).toHaveBeenCalledWith('loaded')
        })
        await expect.element(screen.getByRole('img', { name: 'John' })).toBeVisible()
      } finally {
        restore()
      }
    })
  })
})
