import { act, renderHook } from '@testing-library/react'
import { useDraggableUploader } from './hooks'

type MockDragEventOverrides = {
  dataTransfer?: { files: File[] }
}

const createDragEvent = (overrides: MockDragEventOverrides = {}): React.DragEvent<HTMLDivElement> => ({
  preventDefault: vi.fn(),
  stopPropagation: vi.fn(),
  dataTransfer: { files: [] as unknown as FileList },
  ...overrides,
} as unknown as React.DragEvent<HTMLDivElement>)

describe('useDraggableUploader', () => {
  let setImageFn: ReturnType<typeof vi.fn<(file: File) => void>>

  beforeEach(() => {
    vi.clearAllMocks()
    setImageFn = vi.fn<(file: File) => void>()
  })

  describe('Rendering', () => {
    it('should return all expected handler functions and isDragActive state', () => {
      const { result } = renderHook(() => useDraggableUploader(setImageFn))

      expect(result.current.handleDragEnter).toBeInstanceOf(Function)
      expect(result.current.handleDragOver).toBeInstanceOf(Function)
      expect(result.current.handleDragLeave).toBeInstanceOf(Function)
      expect(result.current.handleDrop).toBeInstanceOf(Function)
      expect(result.current.isDragActive).toBe(false)
    })
  })

  describe('Drag Events', () => {
    it('should set isDragActive to true on drag enter', () => {
      const { result } = renderHook(() => useDraggableUploader(setImageFn))
      const event = createDragEvent()

      act(() => {
        result.current.handleDragEnter(event)
      })

      expect(result.current.isDragActive).toBe(true)
      expect(event.preventDefault).toHaveBeenCalled()
      expect(event.stopPropagation).toHaveBeenCalled()
    })

    it('should call preventDefault and stopPropagation on drag over without changing isDragActive', () => {
      const { result } = renderHook(() => useDraggableUploader(setImageFn))
      const event = createDragEvent()

      act(() => {
        result.current.handleDragOver(event)
      })

      expect(result.current.isDragActive).toBe(false)
      expect(event.preventDefault).toHaveBeenCalled()
      expect(event.stopPropagation).toHaveBeenCalled()
    })

    it('should set isDragActive to false on drag leave', () => {
      const { result } = renderHook(() => useDraggableUploader(setImageFn))
      const enterEvent = createDragEvent()
      const leaveEvent = createDragEvent()

      act(() => {
        result.current.handleDragEnter(enterEvent)
      })
      expect(result.current.isDragActive).toBe(true)

      act(() => {
        result.current.handleDragLeave(leaveEvent)
      })

      expect(result.current.isDragActive).toBe(false)
      expect(leaveEvent.preventDefault).toHaveBeenCalled()
      expect(leaveEvent.stopPropagation).toHaveBeenCalled()
    })
  })

  describe('Drop', () => {
    it('should call setImageFn with the dropped file and set isDragActive to false', () => {
      const { result } = renderHook(() => useDraggableUploader(setImageFn))
      const file = new File(['test'], 'image.png', { type: 'image/png' })
      const event = createDragEvent({
        dataTransfer: { files: [file] },
      })

      // First set isDragActive to true
      act(() => {
        result.current.handleDragEnter(createDragEvent())
      })
      expect(result.current.isDragActive).toBe(true)

      act(() => {
        result.current.handleDrop(event)
      })

      expect(result.current.isDragActive).toBe(false)
      expect(setImageFn).toHaveBeenCalledWith(file)
      expect(event.preventDefault).toHaveBeenCalled()
      expect(event.stopPropagation).toHaveBeenCalled()
    })

    it('should not call setImageFn when no file is dropped', () => {
      const { result } = renderHook(() => useDraggableUploader(setImageFn))
      const event = createDragEvent({
        dataTransfer: { files: [] },
      })

      act(() => {
        result.current.handleDrop(event)
      })

      expect(setImageFn).not.toHaveBeenCalled()
      expect(result.current.isDragActive).toBe(false)
    })
  })
})
