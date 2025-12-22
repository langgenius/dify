/**
 * Test suite for useDSLDragDrop hook
 *
 * This hook provides drag-and-drop functionality for DSL files, enabling:
 * - File drag detection with visual feedback (dragging state)
 * - YAML/YML file filtering (only accepts .yaml and .yml files)
 * - Enable/disable toggle for conditional drag-and-drop
 * - Cleanup on unmount (removes event listeners)
 */
import type { Mock } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useDSLDragDrop } from './use-dsl-drag-drop'

describe('useDSLDragDrop', () => {
  let container: HTMLDivElement
  let mockOnDSLFileDropped: Mock

  beforeEach(() => {
    vi.clearAllMocks()
    container = document.createElement('div')
    document.body.appendChild(container)
    mockOnDSLFileDropped = vi.fn()
  })

  afterEach(() => {
    document.body.removeChild(container)
  })

  // Helper to create drag events
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

  // Helper to create a mock file
  const createMockFile = (name: string) => {
    return new File(['content'], name, { type: 'application/x-yaml' })
  }

  describe('Basic functionality', () => {
    it('should return dragging state', () => {
      const containerRef = { current: container }
      const { result } = renderHook(() =>
        useDSLDragDrop({
          onDSLFileDropped: mockOnDSLFileDropped,
          containerRef,
        }),
      )

      expect(result.current.dragging).toBe(false)
    })

    it('should initialize with dragging as false', () => {
      const containerRef = { current: container }
      const { result } = renderHook(() =>
        useDSLDragDrop({
          onDSLFileDropped: mockOnDSLFileDropped,
          containerRef,
        }),
      )

      expect(result.current.dragging).toBe(false)
    })
  })

  describe('Drag events', () => {
    it('should set dragging to true on dragenter with files', () => {
      const containerRef = { current: container }
      const { result } = renderHook(() =>
        useDSLDragDrop({
          onDSLFileDropped: mockOnDSLFileDropped,
          containerRef,
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
      const containerRef = { current: container }
      const { result } = renderHook(() =>
        useDSLDragDrop({
          onDSLFileDropped: mockOnDSLFileDropped,
          containerRef,
        }),
      )

      const event = createDragEvent('dragenter', [])

      act(() => {
        container.dispatchEvent(event)
      })

      expect(result.current.dragging).toBe(false)
    })

    it('should handle dragover event', () => {
      const containerRef = { current: container }
      renderHook(() =>
        useDSLDragDrop({
          onDSLFileDropped: mockOnDSLFileDropped,
          containerRef,
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
      const containerRef = { current: container }
      const { result } = renderHook(() =>
        useDSLDragDrop({
          onDSLFileDropped: mockOnDSLFileDropped,
          containerRef,
        }),
      )

      // First, enter with files
      const enterEvent = createDragEvent('dragenter', [createMockFile('test.yaml')])
      act(() => {
        container.dispatchEvent(enterEvent)
      })
      expect(result.current.dragging).toBe(true)

      // Then leave with null relatedTarget (leaving container)
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

    it('should not set dragging to false on dragleave when within container', () => {
      const containerRef = { current: container }
      const childElement = document.createElement('div')
      container.appendChild(childElement)

      const { result } = renderHook(() =>
        useDSLDragDrop({
          onDSLFileDropped: mockOnDSLFileDropped,
          containerRef,
        }),
      )

      // First, enter with files
      const enterEvent = createDragEvent('dragenter', [createMockFile('test.yaml')])
      act(() => {
        container.dispatchEvent(enterEvent)
      })
      expect(result.current.dragging).toBe(true)

      // Then leave but to a child element
      const leaveEvent = createDragEvent('dragleave')
      Object.defineProperty(leaveEvent, 'relatedTarget', {
        value: childElement,
        writable: false,
      })

      act(() => {
        container.dispatchEvent(leaveEvent)
      })

      expect(result.current.dragging).toBe(true)

      container.removeChild(childElement)
    })
  })

  describe('Drop functionality', () => {
    it('should call onDSLFileDropped for .yaml file', () => {
      const containerRef = { current: container }
      renderHook(() =>
        useDSLDragDrop({
          onDSLFileDropped: mockOnDSLFileDropped,
          containerRef,
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
      const containerRef = { current: container }
      renderHook(() =>
        useDSLDragDrop({
          onDSLFileDropped: mockOnDSLFileDropped,
          containerRef,
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
      const containerRef = { current: container }
      renderHook(() =>
        useDSLDragDrop({
          onDSLFileDropped: mockOnDSLFileDropped,
          containerRef,
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
      const containerRef = { current: container }
      renderHook(() =>
        useDSLDragDrop({
          onDSLFileDropped: mockOnDSLFileDropped,
          containerRef,
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
      const containerRef = { current: container }
      const { result } = renderHook(() =>
        useDSLDragDrop({
          onDSLFileDropped: mockOnDSLFileDropped,
          containerRef,
        }),
      )

      // First, enter with files
      const enterEvent = createDragEvent('dragenter', [createMockFile('test.yaml')])
      act(() => {
        container.dispatchEvent(enterEvent)
      })
      expect(result.current.dragging).toBe(true)

      // Then drop
      const dropEvent = createDragEvent('drop', [createMockFile('test.yaml')])
      act(() => {
        container.dispatchEvent(dropEvent)
      })

      expect(result.current.dragging).toBe(false)
    })

    it('should handle drop with no dataTransfer', () => {
      const containerRef = { current: container }
      renderHook(() =>
        useDSLDragDrop({
          onDSLFileDropped: mockOnDSLFileDropped,
          containerRef,
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
      const containerRef = { current: container }
      renderHook(() =>
        useDSLDragDrop({
          onDSLFileDropped: mockOnDSLFileDropped,
          containerRef,
        }),
      )

      const dropEvent = createDragEvent('drop', [])

      act(() => {
        container.dispatchEvent(dropEvent)
      })

      expect(mockOnDSLFileDropped).not.toHaveBeenCalled()
    })

    it('should only process the first file when multiple files are dropped', () => {
      const containerRef = { current: container }
      renderHook(() =>
        useDSLDragDrop({
          onDSLFileDropped: mockOnDSLFileDropped,
          containerRef,
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
      const containerRef = { current: container }
      const { result } = renderHook(() =>
        useDSLDragDrop({
          onDSLFileDropped: mockOnDSLFileDropped,
          containerRef,
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
      const containerRef = { current: container }
      const { result, rerender } = renderHook(
        ({ enabled }) =>
          useDSLDragDrop({
            onDSLFileDropped: mockOnDSLFileDropped,
            containerRef,
            enabled,
          }),
        { initialProps: { enabled: true } },
      )

      // Set dragging state
      const enterEvent = createDragEvent('dragenter', [createMockFile('test.yaml')])
      act(() => {
        container.dispatchEvent(enterEvent)
      })
      expect(result.current.dragging).toBe(true)

      // Disable the hook
      rerender({ enabled: false })
      expect(result.current.dragging).toBe(false)
    })

    it('should default enabled to true', () => {
      const containerRef = { current: container }
      const { result } = renderHook(() =>
        useDSLDragDrop({
          onDSLFileDropped: mockOnDSLFileDropped,
          containerRef,
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
      const containerRef = { current: container }
      const removeEventListenerSpy = vi.spyOn(container, 'removeEventListener')

      const { unmount } = renderHook(() =>
        useDSLDragDrop({
          onDSLFileDropped: mockOnDSLFileDropped,
          containerRef,
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
    it('should handle null containerRef', () => {
      const containerRef = { current: null }
      const { result } = renderHook(() =>
        useDSLDragDrop({
          onDSLFileDropped: mockOnDSLFileDropped,
          containerRef,
        }),
      )

      expect(result.current.dragging).toBe(false)
    })

    it('should handle containerRef changing to null', () => {
      const containerRef = { current: container as HTMLDivElement | null }
      const { result, rerender } = renderHook(() =>
        useDSLDragDrop({
          onDSLFileDropped: mockOnDSLFileDropped,
          containerRef,
        }),
      )

      containerRef.current = null
      rerender()

      expect(result.current.dragging).toBe(false)
    })
  })
})
