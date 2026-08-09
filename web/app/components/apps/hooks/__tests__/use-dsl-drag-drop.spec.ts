import { act, renderHook } from '@testing-library/react'
import { useDSLDragDrop } from '../use-dsl-drag-drop'

describe('useDSLDragDrop', () => {
  let container: HTMLDivElement
  let mockOnDSLFileDropped = vi.fn<(file: File) => void>()

  beforeEach(() => {
    vi.clearAllMocks()
    container = document.createElement('div')
    document.body.appendChild(container)
    mockOnDSLFileDropped = vi.fn<(file: File) => void>()
  })

  afterEach(() => {
    document.body.removeChild(container)
  })

  const createDragEvent = (type: string, files: File[] = []) => {
    const dataTransfer = {
      types: files.length > 0 ? ['Files'] : [],
      files,
    }

    const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperty(event, 'dataTransfer', {
      value: dataTransfer,
      writable: false,
    })
    Object.defineProperty(event, 'preventDefault', {
      value: vi.fn(),
      writable: false,
    })
    Object.defineProperty(event, 'stopPropagation', {
      value: vi.fn(),
      writable: false,
    })

    return event
  }

  const createMockFile = (name: string) => {
    return new File(['content'], name, { type: 'application/x-yaml' })
  }

  describe('Basic functionality', () => {
    it('should return dragging state', () => {
      const dropZoneRef = { current: container }
      const { result } = renderHook(() =>
        useDSLDragDrop({
          onDSLFileDropped: mockOnDSLFileDropped,
          dropZoneRef,
        }),
      )

      expect(result.current.dragging).toBe(false)
    })

    it('should initialize with dragging as false', () => {
      const dropZoneRef = { current: container }
      const { result } = renderHook(() =>
        useDSLDragDrop({
          onDSLFileDropped: mockOnDSLFileDropped,
          dropZoneRef,
        }),
      )

      expect(result.current.dragging).toBe(false)
    })
  })

  describe('Drag events', () => {
    it('should set dragging to true on dragenter with files', () => {
      const dropZoneRef = { current: container }
      const { result } = renderHook(() =>
        useDSLDragDrop({
          onDSLFileDropped: mockOnDSLFileDropped,
          dropZoneRef,
        }),
      )

      const file = createMockFile('test.yaml')
      const event = createDragEvent('dragenter', [file])

      act(() => {
        container.dispatchEvent(event)
      })

      expect(result.current.dragging).toBe(true)
    })

    it('should not set dragging on dragenter without files', () => {
      const dropZoneRef = { current: container }
      const { result } = renderHook(() =>
        useDSLDragDrop({
          onDSLFileDropped: mockOnDSLFileDropped,
          dropZoneRef,
        }),
      )

      const event = createDragEvent('dragenter', [])

      act(() => {
        container.dispatchEvent(event)
      })

      expect(result.current.dragging).toBe(false)
    })

    it('should handle dragover event', () => {
      const dropZoneRef = { current: container }
      renderHook(() =>
        useDSLDragDrop({
          onDSLFileDropped: mockOnDSLFileDropped,
          dropZoneRef,
        }),
      )

      const event = createDragEvent('dragover')

      act(() => {
        container.dispatchEvent(event)
      })

      expect(event.preventDefault).toHaveBeenCalled()
      expect(event.stopPropagation).toHaveBeenCalled()
    })

    it('should set dragging to false on dragleave when leaving container', () => {
      const dropZoneRef = { current: container }
      const { result } = renderHook(() =>
        useDSLDragDrop({
          onDSLFileDropped: mockOnDSLFileDropped,
          dropZoneRef,
        }),
      )

      const enterEvent = createDragEvent('dragenter', [createMockFile('test.yaml')])
      act(() => {
        container.dispatchEvent(enterEvent)
      })
      expect(result.current.dragging).toBe(true)

      const leaveEvent = createDragEvent('dragleave')
      Object.defineProperty(leaveEvent, 'relatedTarget', {
        value: null,
        writable: false,
      })

      act(() => {
        container.dispatchEvent(leaveEvent)
      })

      expect(result.current.dragging).toBe(false)
    })

    it('should keep dragging while moving from the viewport to its sibling overlay', () => {
      const dropZoneRef = { current: container }
      const viewport = document.createElement('div')
      const overlay = document.createElement('div')
      container.append(viewport, overlay)

      const { result } = renderHook(() =>
        useDSLDragDrop({
          onDSLFileDropped: mockOnDSLFileDropped,
          dropZoneRef,
        }),
      )

      const enterEvent = createDragEvent('dragenter', [createMockFile('test.yaml')])
      act(() => {
        viewport.dispatchEvent(enterEvent)
      })
      expect(result.current.dragging).toBe(true)

      const leaveEvent = createDragEvent('dragleave')
      Object.defineProperty(leaveEvent, 'relatedTarget', {
        value: overlay,
        writable: false,
      })

      act(() => {
        viewport.dispatchEvent(leaveEvent)
      })

      expect(result.current.dragging).toBe(true)
    })
  })

  describe('Drop functionality', () => {
    it('should call onDSLFileDropped for .yaml file', () => {
      const dropZoneRef = { current: container }
      renderHook(() =>
        useDSLDragDrop({
          onDSLFileDropped: mockOnDSLFileDropped,
          dropZoneRef,
        }),
      )

      const file = createMockFile('test.yaml')
      const dropEvent = createDragEvent('drop', [file])

      act(() => {
        container.dispatchEvent(dropEvent)
      })

      expect(mockOnDSLFileDropped).toHaveBeenCalledWith(file)
    })

    it('should call onDSLFileDropped for .yml file', () => {
      const dropZoneRef = { current: container }
      renderHook(() =>
        useDSLDragDrop({
          onDSLFileDropped: mockOnDSLFileDropped,
          dropZoneRef,
        }),
      )

      const file = createMockFile('test.yml')
      const dropEvent = createDragEvent('drop', [file])

      act(() => {
        container.dispatchEvent(dropEvent)
      })

      expect(mockOnDSLFileDropped).toHaveBeenCalledWith(file)
    })

    it('should call onDSLFileDropped for uppercase .YAML file', () => {
      const dropZoneRef = { current: container }
      renderHook(() =>
        useDSLDragDrop({
          onDSLFileDropped: mockOnDSLFileDropped,
          dropZoneRef,
        }),
      )

      const file = createMockFile('test.YAML')
      const dropEvent = createDragEvent('drop', [file])

      act(() => {
        container.dispatchEvent(dropEvent)
      })

      expect(mockOnDSLFileDropped).toHaveBeenCalledWith(file)
    })

    it('should not call onDSLFileDropped for non-yaml file', () => {
      const dropZoneRef = { current: container }
      renderHook(() =>
        useDSLDragDrop({
          onDSLFileDropped: mockOnDSLFileDropped,
          dropZoneRef,
        }),
      )

      const file = createMockFile('test.json')
      const dropEvent = createDragEvent('drop', [file])

      act(() => {
        container.dispatchEvent(dropEvent)
      })

      expect(mockOnDSLFileDropped).not.toHaveBeenCalled()
    })

    it('should set dragging to false on drop', () => {
      const dropZoneRef = { current: container }
      const { result } = renderHook(() =>
        useDSLDragDrop({
          onDSLFileDropped: mockOnDSLFileDropped,
          dropZoneRef,
        }),
      )

      const enterEvent = createDragEvent('dragenter', [createMockFile('test.yaml')])
      act(() => {
        container.dispatchEvent(enterEvent)
      })
      expect(result.current.dragging).toBe(true)

      const dropEvent = createDragEvent('drop', [createMockFile('test.yaml')])
      act(() => {
        container.dispatchEvent(dropEvent)
      })

      expect(result.current.dragging).toBe(false)
    })

    it('should handle drop with no dataTransfer', () => {
      const dropZoneRef = { current: container }
      renderHook(() =>
        useDSLDragDrop({
          onDSLFileDropped: mockOnDSLFileDropped,
          dropZoneRef,
        }),
      )

      const event = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent
      Object.defineProperty(event, 'dataTransfer', {
        value: null,
        writable: false,
      })
      Object.defineProperty(event, 'preventDefault', {
        value: vi.fn(),
        writable: false,
      })
      Object.defineProperty(event, 'stopPropagation', {
        value: vi.fn(),
        writable: false,
      })

      act(() => {
        container.dispatchEvent(event)
      })

      expect(mockOnDSLFileDropped).not.toHaveBeenCalled()
    })

    it('should handle drop with empty files array', () => {
      const dropZoneRef = { current: container }
      renderHook(() =>
        useDSLDragDrop({
          onDSLFileDropped: mockOnDSLFileDropped,
          dropZoneRef,
        }),
      )

      const dropEvent = createDragEvent('drop', [])

      act(() => {
        container.dispatchEvent(dropEvent)
      })

      expect(mockOnDSLFileDropped).not.toHaveBeenCalled()
    })

    it('should only process the first file when multiple files are dropped', () => {
      const dropZoneRef = { current: container }
      renderHook(() =>
        useDSLDragDrop({
          onDSLFileDropped: mockOnDSLFileDropped,
          dropZoneRef,
        }),
      )

      const file1 = createMockFile('test1.yaml')
      const file2 = createMockFile('test2.yaml')
      const dropEvent = createDragEvent('drop', [file1, file2])

      act(() => {
        container.dispatchEvent(dropEvent)
      })

      expect(mockOnDSLFileDropped).toHaveBeenCalledTimes(1)
      expect(mockOnDSLFileDropped).toHaveBeenCalledWith(file1)
    })
  })

  describe('Enabled prop', () => {
    it('should not add event listeners when enabled is false', () => {
      const dropZoneRef = { current: container }
      const { result } = renderHook(() =>
        useDSLDragDrop({
          onDSLFileDropped: mockOnDSLFileDropped,
          dropZoneRef,
          enabled: false,
        }),
      )

      const file = createMockFile('test.yaml')
      const enterEvent = createDragEvent('dragenter', [file])

      act(() => {
        container.dispatchEvent(enterEvent)
      })

      expect(result.current.dragging).toBe(false)
    })

    it('should return dragging as false when enabled is false even if state is true', () => {
      const dropZoneRef = { current: container }
      const { result, rerender } = renderHook(
        ({ enabled }) =>
          useDSLDragDrop({
            onDSLFileDropped: mockOnDSLFileDropped,
            dropZoneRef,
            enabled,
          }),
        { initialProps: { enabled: true } },
      )

      const enterEvent = createDragEvent('dragenter', [createMockFile('test.yaml')])
      act(() => {
        container.dispatchEvent(enterEvent)
      })
      expect(result.current.dragging).toBe(true)

      rerender({ enabled: false })
      expect(result.current.dragging).toBe(false)
    })

    it('should default enabled to true', () => {
      const dropZoneRef = { current: container }
      const { result } = renderHook(() =>
        useDSLDragDrop({
          onDSLFileDropped: mockOnDSLFileDropped,
          dropZoneRef,
        }),
      )

      const enterEvent = createDragEvent('dragenter', [createMockFile('test.yaml')])

      act(() => {
        container.dispatchEvent(enterEvent)
      })

      expect(result.current.dragging).toBe(true)
    })
  })

  describe('Cleanup', () => {
    it('should remove event listeners on unmount', () => {
      const dropZoneRef = { current: container }
      const removeEventListenerSpy = vi.spyOn(container, 'removeEventListener')

      const { unmount } = renderHook(() =>
        useDSLDragDrop({
          onDSLFileDropped: mockOnDSLFileDropped,
          dropZoneRef,
        }),
      )

      unmount()

      expect(removeEventListenerSpy).toHaveBeenCalledWith('dragenter', expect.any(Function))
      expect(removeEventListenerSpy).toHaveBeenCalledWith('dragover', expect.any(Function))
      expect(removeEventListenerSpy).toHaveBeenCalledWith('dragleave', expect.any(Function))
      expect(removeEventListenerSpy).toHaveBeenCalledWith('drop', expect.any(Function))

      removeEventListenerSpy.mockRestore()
    })
  })

  describe('Edge cases', () => {
    it('should handle null dropZoneRef', () => {
      const dropZoneRef = { current: null }
      const { result } = renderHook(() =>
        useDSLDragDrop({
          onDSLFileDropped: mockOnDSLFileDropped,
          dropZoneRef,
        }),
      )

      expect(result.current.dragging).toBe(false)
    })

    it('should handle dropZoneRef changing to null', () => {
      const dropZoneRef = { current: container as HTMLDivElement | null }
      const { result, rerender } = renderHook(() =>
        useDSLDragDrop({
          onDSLFileDropped: mockOnDSLFileDropped,
          dropZoneRef,
        }),
      )

      dropZoneRef.current = null
      rerender()

      expect(result.current.dragging).toBe(false)
    })
  })
})
