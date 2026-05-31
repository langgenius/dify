import { act, renderHook } from '@testing-library/react'
import { useGotoAnythingModal } from '../use-goto-anything-modal'

type KeyPressEvent = {
  preventDefault: () => void
  target?: EventTarget
}

type HotkeyRegistration = {
  handler: (event: KeyPressEvent) => void
  options?: { enabled?: boolean, ignoreInputs?: boolean }
}

const hotkeyHandlers: Record<string, HotkeyRegistration> = {}

vi.mock('@tanstack/react-hotkeys', () => ({
  useHotkey: (
    hotkey: string,
    handler: (event: KeyPressEvent) => void,
    options?: HotkeyRegistration['options'],
  ) => {
    hotkeyHandlers[hotkey] = { handler, options }
  },
}))

const triggerHotkey = (hotkey: string, event: KeyPressEvent) => {
  const registration = hotkeyHandlers[hotkey]
  if (registration?.options?.enabled === false)
    return

  registration?.handler(event)
}

describe('useGotoAnythingModal', () => {
  beforeEach(() => {
    Object.keys(hotkeyHandlers).forEach(key => delete hotkeyHandlers[key])
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('initialization', () => {
    it('should initialize with show=false', () => {
      const { result } = renderHook(() => useGotoAnythingModal())
      expect(result.current.show).toBe(false)
    })

    it('should provide inputRef initialized to null', () => {
      const { result } = renderHook(() => useGotoAnythingModal())
      expect(result.current.inputRef).toBeDefined()
      expect(result.current.inputRef.current).toBe(null)
    })

    it('should provide setShow function', () => {
      const { result } = renderHook(() => useGotoAnythingModal())
      expect(typeof result.current.setShow).toBe('function')
    })

    it('should provide handleClose function', () => {
      const { result } = renderHook(() => useGotoAnythingModal())
      expect(typeof result.current.handleClose).toBe('function')
    })
  })

  describe('keyboard shortcuts', () => {
    it('should toggle show state when Mod+K is triggered', () => {
      const { result } = renderHook(() => useGotoAnythingModal())

      expect(result.current.show).toBe(false)

      act(() => {
        triggerHotkey('Mod+K', { preventDefault: vi.fn(), target: document.body })
      })

      expect(result.current.show).toBe(true)
    })

    it('should toggle back to closed when Mod+K is triggered twice', () => {
      const { result } = renderHook(() => useGotoAnythingModal())

      act(() => {
        triggerHotkey('Mod+K', { preventDefault: vi.fn(), target: document.body })
      })
      expect(result.current.show).toBe(true)

      act(() => {
        triggerHotkey('Mod+K', { preventDefault: vi.fn(), target: document.body })
      })
      expect(result.current.show).toBe(false)
    })

    it('should let the hotkey library ignore inputs when the modal is closed', () => {
      renderHook(() => useGotoAnythingModal())

      expect(hotkeyHandlers['Mod+K']?.options?.ignoreInputs).toBe(true)
    })

    it('should close modal when escape is pressed and modal is open', () => {
      const { result } = renderHook(() => useGotoAnythingModal())

      act(() => {
        result.current.setShow(true)
      })
      expect(result.current.show).toBe(true)

      act(() => {
        triggerHotkey('Escape', { preventDefault: vi.fn() })
      })

      expect(result.current.show).toBe(false)
    })

    it('should NOT do anything when escape is pressed and modal is already closed', () => {
      const { result } = renderHook(() => useGotoAnythingModal())

      expect(result.current.show).toBe(false)

      const preventDefaultMock = vi.fn()
      act(() => {
        triggerHotkey('Escape', { preventDefault: preventDefaultMock })
      })

      expect(result.current.show).toBe(false)
      expect(preventDefaultMock).not.toHaveBeenCalled()
    })

    it('should call preventDefault when Mod+K is triggered', () => {
      renderHook(() => useGotoAnythingModal())

      const preventDefaultMock = vi.fn()
      act(() => {
        triggerHotkey('Mod+K', { preventDefault: preventDefaultMock, target: document.body })
      })

      expect(preventDefaultMock).toHaveBeenCalled()
    })
  })

  describe('handleClose', () => {
    it('should close modal when handleClose is called', () => {
      const { result } = renderHook(() => useGotoAnythingModal())

      act(() => {
        result.current.setShow(true)
      })
      expect(result.current.show).toBe(true)

      act(() => {
        result.current.handleClose()
      })

      expect(result.current.show).toBe(false)
    })

    it('should be safe to call handleClose when modal is already closed', () => {
      const { result } = renderHook(() => useGotoAnythingModal())

      expect(result.current.show).toBe(false)

      act(() => {
        result.current.handleClose()
      })

      expect(result.current.show).toBe(false)
    })
  })

  describe('setShow', () => {
    it('should accept boolean value', () => {
      const { result } = renderHook(() => useGotoAnythingModal())

      act(() => {
        result.current.setShow(true)
      })
      expect(result.current.show).toBe(true)

      act(() => {
        result.current.setShow(false)
      })
      expect(result.current.show).toBe(false)
    })

    it('should accept function value', () => {
      const { result } = renderHook(() => useGotoAnythingModal())

      act(() => {
        result.current.setShow(prev => !prev)
      })
      expect(result.current.show).toBe(true)

      act(() => {
        result.current.setShow(prev => !prev)
      })
      expect(result.current.show).toBe(false)
    })
  })

  describe('focus management', () => {
    it('should call requestAnimationFrame when modal opens', () => {
      const rafSpy = vi.spyOn(window, 'requestAnimationFrame')
      const { result } = renderHook(() => useGotoAnythingModal())

      act(() => {
        result.current.setShow(true)
      })

      expect(rafSpy).toHaveBeenCalled()
      rafSpy.mockRestore()
    })

    it('should not call requestAnimationFrame when modal closes', () => {
      const { result } = renderHook(() => useGotoAnythingModal())

      act(() => {
        result.current.setShow(true)
      })

      const rafSpy = vi.spyOn(window, 'requestAnimationFrame')

      act(() => {
        result.current.setShow(false)
      })

      expect(rafSpy).not.toHaveBeenCalled()
      rafSpy.mockRestore()
    })

    it('should focus input when modal opens and inputRef.current exists', () => {
      const originalRAF = window.requestAnimationFrame
      window.requestAnimationFrame = (callback: FrameRequestCallback) => {
        callback(0)
        return 0
      }

      const { result } = renderHook(() => useGotoAnythingModal())

      const mockFocus = vi.fn()
      const mockInput = { focus: mockFocus } as unknown as HTMLInputElement

      Object.defineProperty(result.current.inputRef, 'current', {
        value: mockInput,
        writable: true,
      })

      act(() => {
        result.current.setShow(true)
      })

      expect(mockFocus).toHaveBeenCalled()

      window.requestAnimationFrame = originalRAF
    })

    it('should not throw when inputRef.current is null when modal opens', () => {
      const originalRAF = window.requestAnimationFrame
      window.requestAnimationFrame = (callback: FrameRequestCallback) => {
        callback(0)
        return 0
      }

      const { result } = renderHook(() => useGotoAnythingModal())

      act(() => {
        result.current.setShow(true)
      })

      expect(result.current.show).toBe(true)

      window.requestAnimationFrame = originalRAF
    })
  })
})
