import type { Area } from 'react-easy-crop'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ImageInput from './ImageInput'

vi.mock('react-easy-crop', () => ({
  default: ({ onCropComplete }: { onCropComplete: (crop: Area, pixelCrop: Area) => void }) => {
    return (
      <div data-testid="mock-cropper">
        <button
          type="button"
          data-testid="trigger-crop"
          onClick={() => onCropComplete(
            { x: 0, y: 0, width: 100, height: 100 },
            { x: 10, y: 20, width: 80, height: 80 },
          )}
        >
          Trigger Crop
        </button>
      </div>
    )
  },
}))

const createObjectURLMock = vi.fn(() => 'blob:mock-url')
const revokeObjectURLMock = vi.fn()
const originalCreateObjectURL = globalThis.URL.createObjectURL
const originalRevokeObjectURL = globalThis.URL.revokeObjectURL

describe('ImageInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    globalThis.URL.createObjectURL = createObjectURLMock
    globalThis.URL.revokeObjectURL = revokeObjectURLMock
  })

  afterEach(() => {
    globalThis.URL.createObjectURL = originalCreateObjectURL
    globalThis.URL.revokeObjectURL = originalRevokeObjectURL
  })

  describe('Rendering', () => {
    it('should render upload prompt when no image is selected', () => {
      render(<ImageInput />)

      expect(screen.getByText(/drop.*here/i)).toBeInTheDocument()
      expect(screen.getByText(/browse/i)).toBeInTheDocument()
      expect(screen.getByText(/supported/i)).toBeInTheDocument()
    })

    it('should render a hidden file input', () => {
      render(<ImageInput />)

      const input = screen.getByTestId('image-input')
      expect(input).toBeInTheDocument()
      expect(input).toHaveClass('hidden')
    })
  })

  describe('Props', () => {
    it('should apply custom className', () => {
      const { container } = render(<ImageInput className="my-custom-class" />)
      expect(container.firstChild).toHaveClass('my-custom-class')
    })
  })

  describe('User Interactions', () => {
    it('should trigger file input click when browse button is clicked', () => {
      render(<ImageInput />)

      const fileInput = screen.getByTestId('image-input')
      const clickSpy = vi.spyOn(fileInput, 'click')

      fireEvent.click(screen.getByText(/browse/i))

      expect(clickSpy).toHaveBeenCalled()
    })

    it('should show Cropper when a static image file is selected', async () => {
      render(<ImageInput />)

      const file = new File(['image-data'], 'photo.png', { type: 'image/png' })
      const input = screen.getByTestId('image-input')
      fireEvent.change(input, { target: { files: [file] } })

      await waitFor(() => {
        expect(screen.getByTestId('mock-cropper')).toBeInTheDocument()
      })

      // Upload prompt should be gone
      expect(screen.queryByText(/browse/i)).not.toBeInTheDocument()
    })

    it('should call onImageInput with cropped data when crop completes on static image', async () => {
      const onImageInput = vi.fn()
      render(<ImageInput onImageInput={onImageInput} />)

      const file = new File(['image-data'], 'photo.png', { type: 'image/png' })
      const input = screen.getByTestId('image-input')
      fireEvent.change(input, { target: { files: [file] } })

      await waitFor(() => {
        expect(screen.getByTestId('mock-cropper')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('trigger-crop'))

      expect(onImageInput).toHaveBeenCalledWith(
        true,
        'blob:mock-url',
        { x: 10, y: 20, width: 80, height: 80 },
        'photo.png',
      )
    })

    it('should show img tag and call onImageInput with isCropped=false for animated GIF', async () => {
      const onImageInput = vi.fn()
      render(<ImageInput onImageInput={onImageInput} />)

      const gifBytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
      const file = new File([gifBytes], 'anim.gif', { type: 'image/gif' })
      const input = screen.getByTestId('image-input')
      fireEvent.change(input, { target: { files: [file] } })

      await waitFor(() => {
        const img = screen.queryByTestId('animated-image') as HTMLImageElement
        expect(img).toBeInTheDocument()
        expect(img?.src).toContain('blob:mock-url')
      })

      // Cropper should NOT be shown
      expect(screen.queryByTestId('mock-cropper')).not.toBeInTheDocument()
      expect(onImageInput).toHaveBeenCalledWith(false, file)
    })

    it('should not crash when file input has no files', () => {
      render(<ImageInput />)

      const input = screen.getByTestId('image-input')
      fireEvent.change(input, { target: { files: null } })

      // Should still show upload prompt
      expect(screen.getByText(/browse/i)).toBeInTheDocument()
    })

    it('should reset file input value on click', () => {
      render(<ImageInput />)

      const input = screen.getByTestId('image-input') as HTMLInputElement
      // Simulate previous value
      Object.defineProperty(input, 'value', { writable: true, value: 'old-file.png' })
      fireEvent.click(input)
      expect(input.value).toBe('')
    })
  })

  describe('Drag and Drop', () => {
    it('should apply active border class on drag enter', () => {
      render(<ImageInput />)

      const dropZone = screen.getByText(/browse/i).closest('[class*="border-dashed"]') as HTMLElement

      fireEvent.dragEnter(dropZone)
      expect(dropZone).toHaveClass('border-primary-600')
    })

    it('should remove active border class on drag leave', () => {
      render(<ImageInput />)

      const dropZone = screen.getByText(/browse/i).closest('[class*="border-dashed"]') as HTMLElement

      fireEvent.dragEnter(dropZone)
      expect(dropZone).toHaveClass('border-primary-600')

      fireEvent.dragLeave(dropZone)
      expect(dropZone).not.toHaveClass('border-primary-600')
    })

    it('should show image after dropping a file', async () => {
      render(<ImageInput />)

      const dropZone = screen.getByText(/browse/i).closest('[class*="border-dashed"]') as HTMLElement
      const file = new File(['image-data'], 'dropped.png', { type: 'image/png' })

      fireEvent.drop(dropZone, {
        dataTransfer: { files: [file] },
      })

      await waitFor(() => {
        expect(screen.getByTestId('mock-cropper')).toBeInTheDocument()
      })
    })
  })

  describe('Cleanup', () => {
    it('should call URL.revokeObjectURL on unmount when an image was set', async () => {
      const { unmount } = render(<ImageInput />)

      const file = new File(['image-data'], 'photo.png', { type: 'image/png' })
      const input = screen.getByTestId('image-input')
      fireEvent.change(input, { target: { files: [file] } })

      await waitFor(() => {
        expect(screen.getByTestId('mock-cropper')).toBeInTheDocument()
      })

      unmount()

      expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:mock-url')
    })

    it('should not call URL.revokeObjectURL on unmount when no image was set', () => {
      const { unmount } = render(<ImageInput />)
      unmount()
      expect(revokeObjectURLMock).not.toHaveBeenCalled()
    })
  })

  describe('Edge Cases', () => {
    it('should not crash when onImageInput is not provided', async () => {
      render(<ImageInput />)

      const file = new File(['image-data'], 'photo.png', { type: 'image/png' })
      const input = screen.getByTestId('image-input')

      // Should not throw
      fireEvent.change(input, { target: { files: [file] } })

      await waitFor(() => {
        expect(screen.getByTestId('mock-cropper')).toBeInTheDocument()
      })

      // Triggering crop should also not throw
      fireEvent.click(screen.getByTestId('trigger-crop'))
    })

    it('should accept the correct file extensions', () => {
      render(<ImageInput />)

      const input = screen.getByTestId('image-input') as HTMLInputElement
      expect(input.accept).toContain('.png')
      expect(input.accept).toContain('.jpg')
      expect(input.accept).toContain('.jpeg')
      expect(input.accept).toContain('.webp')
      expect(input.accept).toContain('.gif')
    })
  })
})
