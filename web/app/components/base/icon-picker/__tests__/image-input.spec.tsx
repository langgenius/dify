import { createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ImageIconInput as ImageInput } from '../image-input'

const createObjectURLMock = vi.fn(() => 'blob:mock-url')
const revokeObjectURLMock = vi.fn()
const originalCreateObjectURL = globalThis.URL.createObjectURL
const originalRevokeObjectURL = globalThis.URL.revokeObjectURL

const waitForCropperContainer = async () => {
  await waitFor(() => {
    expect(screen.getByTestId('container')).toBeInTheDocument()
  })
}

const loadCropperImage = async () => {
  await waitForCropperContainer()
  const cropperImage = screen.getByTestId('container').querySelector('img')
  if (!cropperImage) throw new Error('Could not find cropper image')

  fireEvent.load(cropperImage)
}

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

      await waitForCropperContainer()

      // Upload prompt should be gone
      expect(screen.queryByText(/browse/i)).not.toBeInTheDocument()
    })

    it('should call onChange with cropped data when crop completes on static image', async () => {
      const onChange = vi.fn()
      render(<ImageInput onChange={onChange} />)

      const file = new File(['image-data'], 'photo.png', { type: 'image/png' })
      const input = screen.getByTestId('image-input')
      fireEvent.change(input, { target: { files: [file] } })

      await loadCropperImage()

      expect(screen.getByRole('group', { name: 'app.iconPicker.crop' })).toBeInTheDocument()
      expect(screen.getByRole('slider', { name: 'app.iconPicker.zoom' })).toBeInTheDocument()

      await waitFor(() => {
        expect(onChange).toHaveBeenCalledWith({
          type: 'crop',
          url: 'blob:mock-url',
          area: expect.objectContaining({
            x: expect.any(Number),
            y: expect.any(Number),
            width: expect.any(Number),
            height: expect.any(Number),
          }),
          fileName: 'photo.png',
        })
      })
    })

    it('should show img tag and call onChange with isCropped=false for animated GIF', async () => {
      const onChange = vi.fn()
      render(<ImageInput onChange={onChange} />)

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
      expect(screen.queryByTestId('container')).not.toBeInTheDocument()
      expect(onChange).toHaveBeenCalledWith({ type: 'file', file })
    })

    it('should reset file input value after selection', () => {
      render(<ImageInput />)

      const input = screen.getByTestId('image-input') as HTMLInputElement
      // Simulate previous value
      Object.defineProperty(input, 'value', { writable: true, value: 'old-file.png' })
      fireEvent.change(input, { target: { files: [] } })
      expect(input.value).toBe('')
    })
  })

  describe('Drag and Drop', () => {
    it('accepts file drag gestures on nested content without consuming text drags', async () => {
      const onDragEnter = vi.fn()
      const onDragOver = vi.fn()
      const onDragLeave = vi.fn()
      render(
        <div onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave}>
          <ImageInput />
        </div>,
      )
      const target = screen.getByRole('button', { name: /browse/i })
      const fileTransfer = {
        types: ['Files'],
        files: [new File(['image'], 'photo.png', { type: 'image/png' })],
        dropEffect: 'none',
      }
      for (const dataTransfer of [{ types: ['text/plain'], files: [] }, fileTransfer]) {
        for (const createDragEvent of [
          createEvent.dragEnter,
          createEvent.dragOver,
          createEvent.dragLeave,
        ]) {
          const event = createDragEvent(target, { dataTransfer })
          fireEvent(target, event)
          expect(event.defaultPrevented).toBe(dataTransfer === fileTransfer && event.cancelable)
          if (event.type === 'dragover' && dataTransfer === fileTransfer)
            expect((event as DragEvent).dataTransfer?.dropEffect).toBe('copy')
        }
      }
      expect(onDragEnter).toHaveBeenCalledOnce()
      expect(onDragOver).toHaveBeenCalledOnce()
      expect(onDragLeave).toHaveBeenCalledOnce()
      fireEvent.drop(target, { dataTransfer: fileTransfer })
      await waitForCropperContainer()
    })

    it('consumes file drops inside the picker but leaves text drops to the parent', async () => {
      const onDrop = vi.fn()
      render(
        <div onDrop={onDrop}>
          <ImageInput />
        </div>,
      )
      const target = screen.getByRole('button', { name: /browse/i })
      const textDrop = createEvent.drop(target, {
        dataTransfer: { types: ['text/plain'], files: [] },
      })
      fireEvent(target, textDrop)
      expect(textDrop.defaultPrevented).toBe(false)
      expect(onDrop).toHaveBeenCalledOnce()
      const fileDrop = createEvent.drop(target, {
        dataTransfer: {
          types: ['Files'],
          files: [new File(['image'], 'photo.png', { type: 'image/png' })],
        },
      })
      fireEvent(target, fileDrop)
      expect(fileDrop.defaultPrevented).toBe(true)
      expect(onDrop).toHaveBeenCalledOnce()
      await waitForCropperContainer()
    })

    it('should show image after dropping a file', async () => {
      render(<ImageInput />)

      const dropZone = screen
        .getByText(/browse/i)
        .closest('[class*="border-dashed"]') as HTMLElement
      const file = new File(['image-data'], 'dropped.png', { type: 'image/png' })

      fireEvent.drop(dropZone, {
        dataTransfer: { files: [file], types: ['Files'] },
      })

      await waitForCropperContainer()
    })
  })

  describe('Cleanup', () => {
    it('should call URL.revokeObjectURL on unmount when an image was set', async () => {
      const { unmount } = render(<ImageInput />)

      const file = new File(['image-data'], 'photo.png', { type: 'image/png' })
      const input = screen.getByTestId('image-input')
      fireEvent.change(input, { target: { files: [file] } })

      await waitForCropperContainer()

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
    it('invalidates an unreadable image and makes a replacement available', async () => {
      const onChange = vi.fn()
      render(<ImageInput onChange={onChange} />)
      fireEvent.change(screen.getByTestId('image-input'), {
        target: { files: [new File(['broken'], 'photo.png', { type: 'image/png' })] },
      })
      await waitForCropperContainer()
      fireEvent.error(screen.getByTestId('container').querySelector('img')!)
      expect(onChange).toHaveBeenLastCalledWith(null)
      expect(screen.getByRole('alert').textContent).toMatch(/ReadError/)
      expect(screen.getByRole('button', { name: /browse/i })).toBeInTheDocument()
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
