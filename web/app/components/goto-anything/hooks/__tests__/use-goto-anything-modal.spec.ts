import type { ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import { createElement } from 'react'
import { useGotoAnythingModal } from '../use-goto-anything-modal'

type KeyPressEvent = {
  preventDefault: () => void
  target?: EventTarget
}

type HotkeyRegistration = {
  handler: (event: KeyPressEvent) => void
  options?: { enabled?: boolean; ignoreInputs?: boolean }
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
  if (registration?.options?.enabled === false) return

  registration?.handler(event)
}

const renderGotoAnythingModalHook = () => {
  const store = createStore()
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(Provider, { store }, children)

  return renderHook(() => useGotoAnythingModal(), { wrapper })
}

describe('useGotoAnythingModal', () => {
  beforeEach(() => {
    Object.keys(hotkeyHandlers).forEach((key) => delete hotkeyHandlers[key])
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('initialization', () => {
    it('should initialize with open=false', () => {
      const { result } = renderGotoAnythingModalHook()
      expect(result.current.open).toBe(false)
    })

    it('should provide inputRef initialized to null', () => {
      const { result } = renderGotoAnythingModalHook()
      expect(result.current.inputRef).toBeDefined()
      expect(result.current.inputRef.current).toBe(null)
    })

    it('should provide onOpenChange function', () => {
      const { result } = renderGotoAnythingModalHook()
      expect(typeof result.current.onOpenChange).toBe('function')
    })
  })

  describe('keyboard shortcuts', () => {
    it('should toggle open state when Mod+K is triggered', () => {
      const { result } = renderGotoAnythingModalHook()

      expect(result.current.open).toBe(false)

      act(() => {
        triggerHotkey('Mod+K', { preventDefault: vi.fn(), target: document.body })
      })

      expect(result.current.open).toBe(true)
    })

    it('should toggle back to closed when Mod+K is triggered twice', () => {
      const { result } = renderGotoAnythingModalHook()

      act(() => {
        triggerHotkey('Mod+K', { preventDefault: vi.fn(), target: document.body })
      })
      expect(result.current.open).toBe(true)

      act(() => {
        triggerHotkey('Mod+K', { preventDefault: vi.fn(), target: document.body })
      })
      expect(result.current.open).toBe(false)
    })

    it('should let the hotkey library ignore inputs when the modal is closed', () => {
      renderGotoAnythingModalHook()

      expect(hotkeyHandlers['Mod+K']?.options?.ignoreInputs).toBe(true)
    })

    it('should not register a separate escape hotkey', () => {
      renderGotoAnythingModalHook()

      expect(hotkeyHandlers.Escape).toBeUndefined()
    })

    it('should call preventDefault when Mod+K is triggered', () => {
      renderGotoAnythingModalHook()

      const preventDefaultMock = vi.fn()
      act(() => {
        triggerHotkey('Mod+K', { preventDefault: preventDefaultMock, target: document.body })
      })

      expect(preventDefaultMock).toHaveBeenCalled()
    })
  })

  describe('onOpenChange', () => {
    it('should accept boolean value', () => {
      const { result } = renderGotoAnythingModalHook()

      act(() => {
        result.current.onOpenChange(true)
      })
      expect(result.current.open).toBe(true)

      act(() => {
        result.current.onOpenChange(false)
      })
      expect(result.current.open).toBe(false)
    })
  })

  describe('focus management', () => {
    it('should call requestAnimationFrame when modal opens', () => {
      const rafSpy = vi.spyOn(window, 'requestAnimationFrame')
      const { result } = renderGotoAnythingModalHook()

      act(() => {
        result.current.onOpenChange(true)
      })

      expect(rafSpy).toHaveBeenCalled()
      rafSpy.mockRestore()
    })

    it('should not call requestAnimationFrame when modal closes', () => {
      const { result } = renderGotoAnythingModalHook()

      act(() => {
        result.current.onOpenChange(true)
      })

      const rafSpy = vi.spyOn(window, 'requestAnimationFrame')

      act(() => {
        result.current.onOpenChange(false)
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

      const { result } = renderGotoAnythingModalHook()

      const mockFocus = vi.fn()
      const mockInput = { focus: mockFocus } as unknown as HTMLInputElement

      Object.defineProperty(result.current.inputRef, 'current', {
        value: mockInput,
        writable: true,
      })

      act(() => {
        result.current.onOpenChange(true)
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

      const { result } = renderGotoAnythingModalHook()

      act(() => {
        result.current.onOpenChange(true)
      })

      expect(result.current.open).toBe(true)

      window.requestAnimationFrame = originalRAF
    })
  })
})
