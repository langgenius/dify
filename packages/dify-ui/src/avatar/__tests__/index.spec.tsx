import { render } from 'vitest-browser-react'
import { Avatar } from '..'

const avatarDataUrl = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='

function stubImageLoader() {
  const originalImage = window.Image
  const images: HTMLImageElement[] = []

  function TestImage(_width?: number, _height?: number): HTMLImageElement {
    const image = {
      complete: false,
      crossOrigin: null,
      naturalWidth: 0,
      onerror: null,
      onload: null,
      referrerPolicy: '',
      sizes: '',
      src: '',
      srcset: '',
    } as unknown as HTMLImageElement
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
          <Avatar name="John" avatar={avatarDataUrl} onLoadingStatusChange={onStatusChange} />,
        )

        await expect.element(screen.getByText('J')).toBeVisible()
        await vi.waitFor(() => {
          expect(onStatusChange).toHaveBeenCalledWith('loading')
        })

        images.at(-1)?.onload?.(new Event('load'))

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
