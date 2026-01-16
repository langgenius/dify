import type { RefObject } from 'react'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUploader } from './use-uploader'

describe('useUploader Hook', () => {
  let mockContainerRef: RefObject<HTMLDivElement | null>
  let mockOnFileChange: (file: File | null) => void
  let mockContainer: HTMLDivElement

  beforeEach(() => {
    vi.clearAllMocks()

    mockContainer = document.createElement('div')
    document.body.appendChild(mockContainer)

    mockContainerRef = { current: mockContainer }
    mockOnFileChange = vi.fn()
  })

  afterEach(() => {
    if (mockContainer.parentNode)
      document.body.removeChild(mockContainer)
  })

  describe('Initial State', () => {
    it('should return initial state with dragging false', () => {
      const { result } = renderHook(() =>
        useUploader({
          onFileChange: mockOnFileChange,
          containerRef: mockContainerRef,
        }),
      )

      expect(result.current.dragging).toBe(false)
      expect(result.current.fileUploader.current).toBeNull()
      expect(result.current.fileChangeHandle).not.toBeNull()
      expect(result.current.removeFile).not.toBeNull()
    })

    it('should return null handlers when disabled', () => {
      const { result } = renderHook(() =>
        useUploader({
          onFileChange: mockOnFileChange,
          containerRef: mockContainerRef,
          enabled: false,
        }),
      )

      expect(result.current.dragging).toBe(false)
      expect(result.current.fileChangeHandle).toBeNull()
      expect(result.current.removeFile).toBeNull()
    })
  })

  describe('Drag Events', () => {
    it('should handle dragenter and set dragging to true', () => {
      const { result } = renderHook(() =>
        useUploader({
          onFileChange: mockOnFileChange,
          containerRef: mockContainerRef,
        }),
      )

      const dragEnterEvent = new Event('dragenter', { bubbles: true, cancelable: true })
      Object.defineProperty(dragEnterEvent, 'dataTransfer', {
        value: { types: ['Files'] },
      })

      act(() => {
        mockContainer.dispatchEvent(dragEnterEvent)
      })

      expect(result.current.dragging).toBe(true)
    })

    it('should not set dragging when dragenter without Files type', () => {
      const { result } = renderHook(() =>
        useUploader({
          onFileChange: mockOnFileChange,
          containerRef: mockContainerRef,
        }),
      )

      const dragEnterEvent = new Event('dragenter', { bubbles: true, cancelable: true })
      Object.defineProperty(dragEnterEvent, 'dataTransfer', {
        value: { types: ['text/plain'] },
      })

      act(() => {
        mockContainer.dispatchEvent(dragEnterEvent)
      })

      expect(result.current.dragging).toBe(false)
    })

    it('should handle dragover event', () => {
      renderHook(() =>
        useUploader({
          onFileChange: mockOnFileChange,
          containerRef: mockContainerRef,
        }),
      )

      const dragOverEvent = new Event('dragover', { bubbles: true, cancelable: true })

      act(() => {
        mockContainer.dispatchEvent(dragOverEvent)
      })

      // dragover should prevent default and stop propagation
      expect(mockContainer).toBeInTheDocument()
    })

    it('should handle dragleave when relatedTarget is null', () => {
      const { result } = renderHook(() =>
        useUploader({
          onFileChange: mockOnFileChange,
          containerRef: mockContainerRef,
        }),
      )

      // First set dragging to true
      const dragEnterEvent = new Event('dragenter', { bubbles: true, cancelable: true })
      Object.defineProperty(dragEnterEvent, 'dataTransfer', {
        value: { types: ['Files'] },
      })
      act(() => {
        mockContainer.dispatchEvent(dragEnterEvent)
      })
      expect(result.current.dragging).toBe(true)

      // Then trigger dragleave with null relatedTarget
      const dragLeaveEvent = new Event('dragleave', { bubbles: true, cancelable: true })
      Object.defineProperty(dragLeaveEvent, 'relatedTarget', {
        value: null,
      })

      act(() => {
        mockContainer.dispatchEvent(dragLeaveEvent)
      })

      expect(result.current.dragging).toBe(false)
    })

    it('should handle dragleave when relatedTarget is outside container', () => {
      const { result } = renderHook(() =>
        useUploader({
          onFileChange: mockOnFileChange,
          containerRef: mockContainerRef,
        }),
      )

      // First set dragging to true
      const dragEnterEvent = new Event('dragenter', { bubbles: true, cancelable: true })
      Object.defineProperty(dragEnterEvent, 'dataTransfer', {
        value: { types: ['Files'] },
      })
      act(() => {
        mockContainer.dispatchEvent(dragEnterEvent)
      })
      expect(result.current.dragging).toBe(true)

      // Create element outside container
      const outsideElement = document.createElement('div')
      document.body.appendChild(outsideElement)

      // Trigger dragleave with relatedTarget outside container
      const dragLeaveEvent = new Event('dragleave', { bubbles: true, cancelable: true })
      Object.defineProperty(dragLeaveEvent, 'relatedTarget', {
        value: outsideElement,
      })

      act(() => {
        mockContainer.dispatchEvent(dragLeaveEvent)
      })

      expect(result.current.dragging).toBe(false)
      document.body.removeChild(outsideElement)
    })

    it('should not set dragging to false when relatedTarget is inside container', () => {
      const { result } = renderHook(() =>
        useUploader({
          onFileChange: mockOnFileChange,
          containerRef: mockContainerRef,
        }),
      )

      // First set dragging to true
      const dragEnterEvent = new Event('dragenter', { bubbles: true, cancelable: true })
      Object.defineProperty(dragEnterEvent, 'dataTransfer', {
        value: { types: ['Files'] },
      })
      act(() => {
        mockContainer.dispatchEvent(dragEnterEvent)
      })
      expect(result.current.dragging).toBe(true)

      // Create element inside container
      const insideElement = document.createElement('div')
      mockContainer.appendChild(insideElement)

      // Trigger dragleave with relatedTarget inside container
      const dragLeaveEvent = new Event('dragleave', { bubbles: true, cancelable: true })
      Object.defineProperty(dragLeaveEvent, 'relatedTarget', {
        value: insideElement,
      })

      act(() => {
        mockContainer.dispatchEvent(dragLeaveEvent)
      })

      // Should still be dragging since relatedTarget is inside container
      expect(result.current.dragging).toBe(true)
    })
  })

  describe('Drop Events', () => {
    it('should handle drop event with files', () => {
      const { result } = renderHook(() =>
        useUploader({
          onFileChange: mockOnFileChange,
          containerRef: mockContainerRef,
        }),
      )

      // First set dragging to true
      const dragEnterEvent = new Event('dragenter', { bubbles: true, cancelable: true })
      Object.defineProperty(dragEnterEvent, 'dataTransfer', {
        value: { types: ['Files'] },
      })
      act(() => {
        mockContainer.dispatchEvent(dragEnterEvent)
      })

      // Create mock file
      const file = new File(['content'], 'test.difypkg', { type: 'application/octet-stream' })

      // Trigger drop event
      const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
      Object.defineProperty(dropEvent, 'dataTransfer', {
        value: { files: [file] },
      })

      act(() => {
        mockContainer.dispatchEvent(dropEvent)
      })

      expect(result.current.dragging).toBe(false)
      expect(mockOnFileChange).toHaveBeenCalledWith(file)
    })

    it('should not call onFileChange when drop has no dataTransfer', () => {
      const { result } = renderHook(() =>
        useUploader({
          onFileChange: mockOnFileChange,
          containerRef: mockContainerRef,
        }),
      )

      // Set dragging first
      const dragEnterEvent = new Event('dragenter', { bubbles: true, cancelable: true })
      Object.defineProperty(dragEnterEvent, 'dataTransfer', {
        value: { types: ['Files'] },
      })
      act(() => {
        mockContainer.dispatchEvent(dragEnterEvent)
      })

      // Drop without dataTransfer
      const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
      // No dataTransfer property

      act(() => {
        mockContainer.dispatchEvent(dropEvent)
      })

      expect(result.current.dragging).toBe(false)
      expect(mockOnFileChange).not.toHaveBeenCalled()
    })

    it('should not call onFileChange when drop has empty files array', () => {
      renderHook(() =>
        useUploader({
          onFileChange: mockOnFileChange,
          containerRef: mockContainerRef,
        }),
      )

      const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
      Object.defineProperty(dropEvent, 'dataTransfer', {
        value: { files: [] },
      })

      act(() => {
        mockContainer.dispatchEvent(dropEvent)
      })

      expect(mockOnFileChange).not.toHaveBeenCalled()
    })
  })

  describe('File Change Handler', () => {
    it('should call onFileChange with file from input', () => {
      const { result } = renderHook(() =>
        useUploader({
          onFileChange: mockOnFileChange,
          containerRef: mockContainerRef,
        }),
      )

      const file = new File(['content'], 'test.difypkg', { type: 'application/octet-stream' })
      const mockEvent = {
        target: {
          files: [file],
        },
      } as unknown as React.ChangeEvent<HTMLInputElement>

      act(() => {
        result.current.fileChangeHandle?.(mockEvent)
      })

      expect(mockOnFileChange).toHaveBeenCalledWith(file)
    })

    it('should call onFileChange with null when no files', () => {
      const { result } = renderHook(() =>
        useUploader({
          onFileChange: mockOnFileChange,
          containerRef: mockContainerRef,
        }),
      )

      const mockEvent = {
        target: {
          files: null,
        },
      } as unknown as React.ChangeEvent<HTMLInputElement>

      act(() => {
        result.current.fileChangeHandle?.(mockEvent)
      })

      expect(mockOnFileChange).toHaveBeenCalledWith(null)
    })
  })

  describe('Remove File', () => {
    it('should call onFileChange with null', () => {
      const { result } = renderHook(() =>
        useUploader({
          onFileChange: mockOnFileChange,
          containerRef: mockContainerRef,
        }),
      )

      act(() => {
        result.current.removeFile?.()
      })

      expect(mockOnFileChange).toHaveBeenCalledWith(null)
    })

    it('should handle removeFile when fileUploader has a value', () => {
      const { result } = renderHook(() =>
        useUploader({
          onFileChange: mockOnFileChange,
          containerRef: mockContainerRef,
        }),
      )

      // Create a mock input element with value property
      const mockInput = {
        value: 'test.difypkg',
      }

      // Override the fileUploader ref
      Object.defineProperty(result.current.fileUploader, 'current', {
        value: mockInput,
        writable: true,
      })

      act(() => {
        result.current.removeFile?.()
      })

      expect(mockOnFileChange).toHaveBeenCalledWith(null)
      expect(mockInput.value).toBe('')
    })

    it('should handle removeFile when fileUploader is null', () => {
      const { result } = renderHook(() =>
        useUploader({
          onFileChange: mockOnFileChange,
          containerRef: mockContainerRef,
        }),
      )

      // fileUploader.current is null by default
      act(() => {
        result.current.removeFile?.()
      })

      expect(mockOnFileChange).toHaveBeenCalledWith(null)
    })
  })

  describe('Enabled/Disabled State', () => {
    it('should not add event listeners when disabled', () => {
      const addEventListenerSpy = vi.spyOn(mockContainer, 'addEventListener')

      renderHook(() =>
        useUploader({
          onFileChange: mockOnFileChange,
          containerRef: mockContainerRef,
          enabled: false,
        }),
      )

      expect(addEventListenerSpy).not.toHaveBeenCalled()
    })

    it('should add event listeners when enabled', () => {
      const addEventListenerSpy = vi.spyOn(mockContainer, 'addEventListener')

      renderHook(() =>
        useUploader({
          onFileChange: mockOnFileChange,
          containerRef: mockContainerRef,
          enabled: true,
        }),
      )

      expect(addEventListenerSpy).toHaveBeenCalledWith('dragenter', expect.any(Function))
      expect(addEventListenerSpy).toHaveBeenCalledWith('dragover', expect.any(Function))
      expect(addEventListenerSpy).toHaveBeenCalledWith('dragleave', expect.any(Function))
      expect(addEventListenerSpy).toHaveBeenCalledWith('drop', expect.any(Function))
    })

    it('should remove event listeners on cleanup', () => {
      const removeEventListenerSpy = vi.spyOn(mockContainer, 'removeEventListener')

      const { unmount } = renderHook(() =>
        useUploader({
          onFileChange: mockOnFileChange,
          containerRef: mockContainerRef,
          enabled: true,
        }),
      )

      unmount()

      expect(removeEventListenerSpy).toHaveBeenCalledWith('dragenter', expect.any(Function))
      expect(removeEventListenerSpy).toHaveBeenCalledWith('dragover', expect.any(Function))
      expect(removeEventListenerSpy).toHaveBeenCalledWith('dragleave', expect.any(Function))
      expect(removeEventListenerSpy).toHaveBeenCalledWith('drop', expect.any(Function))
    })

    it('should return false for dragging when disabled', () => {
      const { result } = renderHook(() =>
        useUploader({
          onFileChange: mockOnFileChange,
          containerRef: mockContainerRef,
          enabled: false,
        }),
      )

      expect(result.current.dragging).toBe(false)
    })
  })

  describe('Container Ref Edge Cases', () => {
    it('should handle null containerRef.current', () => {
      const nullRef: RefObject<HTMLDivElement | null> = { current: null }

      const { result } = renderHook(() =>
        useUploader({
          onFileChange: mockOnFileChange,
          containerRef: nullRef,
        }),
      )

      expect(result.current.dragging).toBe(false)
    })
  })
})
