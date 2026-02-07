import { act, renderHook } from '@testing-library/react'
import { useDelayedClick } from './use-delayed-click'

describe('useDelayedClick', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Single Click', () => {
    it('should call onSingleClick after the delay when clicked once', () => {
      const onSingleClick = vi.fn()
      const onDoubleClick = vi.fn()
      const { result } = renderHook(() => useDelayedClick({
        delay: 200,
        onSingleClick,
        onDoubleClick,
      }))

      act(() => {
        result.current.handleClick()
      })

      act(() => {
        vi.advanceTimersByTime(199)
      })
      expect(onSingleClick).not.toHaveBeenCalled()
      expect(onDoubleClick).not.toHaveBeenCalled()

      act(() => {
        vi.advanceTimersByTime(1)
      })
      expect(onSingleClick).toHaveBeenCalledTimes(1)
      expect(onDoubleClick).not.toHaveBeenCalled()
    })

    it('should schedule only one single click when clicked twice before delay ends', () => {
      const onSingleClick = vi.fn()
      const onDoubleClick = vi.fn()
      const { result } = renderHook(() => useDelayedClick({
        delay: 200,
        onSingleClick,
        onDoubleClick,
      }))

      act(() => {
        result.current.handleClick()
      })
      act(() => {
        vi.advanceTimersByTime(100)
      })

      act(() => {
        result.current.handleClick()
      })

      act(() => {
        vi.advanceTimersByTime(199)
      })
      expect(onSingleClick).not.toHaveBeenCalled()

      act(() => {
        vi.advanceTimersByTime(1)
      })
      expect(onSingleClick).toHaveBeenCalledTimes(1)
      expect(onDoubleClick).not.toHaveBeenCalled()
    })
  })

  describe('Double Click', () => {
    it('should cancel pending single click and call onDoubleClick when double-clicked', () => {
      const onSingleClick = vi.fn()
      const onDoubleClick = vi.fn()
      const { result } = renderHook(() => useDelayedClick({
        delay: 200,
        onSingleClick,
        onDoubleClick,
      }))

      act(() => {
        result.current.handleClick()
      })
      act(() => {
        vi.advanceTimersByTime(50)
      })

      act(() => {
        result.current.handleDoubleClick()
      })

      expect(onDoubleClick).toHaveBeenCalledTimes(1)
      expect(onSingleClick).not.toHaveBeenCalled()

      act(() => {
        vi.advanceTimersByTime(300)
      })
      expect(onSingleClick).not.toHaveBeenCalled()
    })

    it('should call onDoubleClick when no single-click timeout is pending', () => {
      const onSingleClick = vi.fn()
      const onDoubleClick = vi.fn()
      const { result } = renderHook(() => useDelayedClick({
        onSingleClick,
        onDoubleClick,
      }))

      act(() => {
        result.current.handleDoubleClick()
      })

      expect(onDoubleClick).toHaveBeenCalledTimes(1)
      expect(onSingleClick).not.toHaveBeenCalled()
    })
  })

  describe('Cleanup', () => {
    it('should clear pending timeout on unmount', () => {
      const onSingleClick = vi.fn()
      const onDoubleClick = vi.fn()
      const { result, unmount } = renderHook(() => useDelayedClick({
        delay: 200,
        onSingleClick,
        onDoubleClick,
      }))

      act(() => {
        result.current.handleClick()
      })

      unmount()

      act(() => {
        vi.advanceTimersByTime(300)
      })

      expect(onSingleClick).not.toHaveBeenCalled()
      expect(onDoubleClick).not.toHaveBeenCalled()
    })
  })
})
