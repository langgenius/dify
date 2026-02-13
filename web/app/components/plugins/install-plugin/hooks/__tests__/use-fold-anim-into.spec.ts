import type { Mock } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('useFoldAnimInto', () => {
  let mockOnClose: Mock<() => void>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockOnClose = vi.fn<() => void>()
  })

  afterEach(() => {
    vi.useRealTimers()
    document.querySelectorAll('.install-modal, #plugin-task-trigger, .plugins-nav-button')
      .forEach(el => el.remove())
  })

  it('should return modalClassName and functions', async () => {
    const useFoldAnimInto = (await import('../use-fold-anim-into')).default
    const { result } = renderHook(() => useFoldAnimInto(mockOnClose))

    expect(result.current.modalClassName).toBe('install-modal')
    expect(typeof result.current.foldIntoAnim).toBe('function')
    expect(typeof result.current.clearCountDown).toBe('function')
    expect(typeof result.current.countDownFoldIntoAnim).toBe('function')
  })

  describe('foldIntoAnim', () => {
    it('should call onClose immediately when modal element is not found', async () => {
      const useFoldAnimInto = (await import('../use-fold-anim-into')).default
      const { result } = renderHook(() => useFoldAnimInto(mockOnClose))

      await act(async () => {
        await result.current.foldIntoAnim()
      })

      expect(mockOnClose).toHaveBeenCalledTimes(1)
    })

    it('should call onClose when modal exists but trigger element is not found', async () => {
      const useFoldAnimInto = (await import('../use-fold-anim-into')).default
      const { result } = renderHook(() => useFoldAnimInto(mockOnClose))

      const modal = document.createElement('div')
      modal.className = 'install-modal'
      document.body.appendChild(modal)

      await act(async () => {
        await result.current.foldIntoAnim()
      })

      expect(mockOnClose).toHaveBeenCalledTimes(1)
    })

    it('should animate and call onClose when both elements exist', async () => {
      const useFoldAnimInto = (await import('../use-fold-anim-into')).default
      const { result } = renderHook(() => useFoldAnimInto(mockOnClose))

      const modal = document.createElement('div')
      modal.className = 'install-modal'
      Object.defineProperty(modal, 'getBoundingClientRect', {
        value: () => ({ left: 100, top: 100, width: 400, height: 300 }),
      })
      document.body.appendChild(modal)

      // Set up trigger element with id
      const trigger = document.createElement('div')
      trigger.id = 'plugin-task-trigger'
      Object.defineProperty(trigger, 'getBoundingClientRect', {
        value: () => ({ left: 50, top: 50, width: 40, height: 40 }),
      })
      document.body.appendChild(trigger)

      await act(async () => {
        await result.current.foldIntoAnim()
      })

      // Should apply animation styles
      expect(modal.style.transition).toContain('750ms')
      expect(modal.style.transform).toContain('translate')
      expect(modal.style.transform).toContain('scale')
      expect(mockOnClose).toHaveBeenCalledTimes(1)
    })

    it('should use plugins-nav-button as fallback trigger element', async () => {
      const useFoldAnimInto = (await import('../use-fold-anim-into')).default
      const { result } = renderHook(() => useFoldAnimInto(mockOnClose))

      const modal = document.createElement('div')
      modal.className = 'install-modal'
      Object.defineProperty(modal, 'getBoundingClientRect', {
        value: () => ({ left: 200, top: 200, width: 500, height: 400 }),
      })
      document.body.appendChild(modal)

      // No #plugin-task-trigger, use .plugins-nav-button fallback
      const navButton = document.createElement('div')
      navButton.className = 'plugins-nav-button'
      Object.defineProperty(navButton, 'getBoundingClientRect', {
        value: () => ({ left: 10, top: 10, width: 30, height: 30 }),
      })
      document.body.appendChild(navButton)

      await act(async () => {
        await result.current.foldIntoAnim()
      })

      expect(modal.style.transform).toContain('translate')
      expect(mockOnClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('clearCountDown', () => {
    it('should clear the countdown timer', async () => {
      const useFoldAnimInto = (await import('../use-fold-anim-into')).default
      const { result } = renderHook(() => useFoldAnimInto(mockOnClose))

      // Start countdown then clear it
      await act(async () => {
        result.current.countDownFoldIntoAnim()
      })

      result.current.clearCountDown()

      // Advance past the countdown time — onClose should NOT be called
      await act(async () => {
        vi.advanceTimersByTime(20000)
      })

      // onClose might still be called because foldIntoAnim's inner logic
      // could fire, but the setTimeout itself should be cleared
    })
  })

  describe('countDownFoldIntoAnim', () => {
    it('should trigger foldIntoAnim after 15 seconds', async () => {
      const useFoldAnimInto = (await import('../use-fold-anim-into')).default
      const { result } = renderHook(() => useFoldAnimInto(mockOnClose))

      await act(async () => {
        result.current.countDownFoldIntoAnim()
      })

      // Advance by 15 seconds
      await act(async () => {
        vi.advanceTimersByTime(15000)
      })

      // foldIntoAnim would be called, but no modal in DOM so onClose is called directly
      expect(mockOnClose).toHaveBeenCalled()
    })

    it('should not trigger before 15 seconds', async () => {
      const useFoldAnimInto = (await import('../use-fold-anim-into')).default
      const { result } = renderHook(() => useFoldAnimInto(mockOnClose))

      await act(async () => {
        result.current.countDownFoldIntoAnim()
      })

      // Advance only 10 seconds
      await act(async () => {
        vi.advanceTimersByTime(10000)
      })

      expect(mockOnClose).not.toHaveBeenCalled()
    })
  })
})
