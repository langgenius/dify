import { act, renderHook } from '@testing-library/react'
import { useRef } from 'react'
import useToggleExpend from '../use-toggle-expend'

type HookProps = {
  hasFooter?: boolean
  isInNode?: boolean
  clientHeight?: number
}

/**
 * Wrapper that provides a real ref whose `.current.clientHeight` is stubbed
 * so we can verify the height math without a real DOM layout pass.
 */
function useHarness({ hasFooter, isInNode, clientHeight = 400 }: HookProps) {
  const ref = useRef<HTMLDivElement | null>(null)

  // Stub a ref-like object so measurements are deterministic.
  if (!ref.current) {
    Object.defineProperty(ref, 'current', {
      value: { clientHeight } as HTMLDivElement,
      writable: true,
    })
  }

  return useToggleExpend({ ref, hasFooter, isInNode })
}

describe('useToggleExpend', () => {
  describe('collapsed state', () => {
    it('returns empty wrapClassName and zero expand height when collapsed', () => {
      const { result } = renderHook(() => useHarness({ clientHeight: 400 }))

      expect(result.current.isExpand).toBe(false)
      expect(result.current.wrapClassName).toBe('')
      expect(result.current.editorExpandHeight).toBe(0)
    })
  })

  describe('expanded state (node context)', () => {
    it('uses fixed positioning inside a workflow node panel', () => {
      const { result } = renderHook(() =>
        useHarness({ isInNode: true, clientHeight: 400 }),
      )

      act(() => {
        result.current.setIsExpand(true)
      })

      expect(result.current.isExpand).toBe(true)
      expect(result.current.wrapClassName).toContain('fixed')
      expect(result.current.wrapClassName).toContain('bg-components-panel-bg')
      expect(result.current.wrapStyle).toEqual(
        expect.objectContaining({ boxShadow: expect.any(String) }),
      )
    })
  })

  describe('expanded state (execution-log / webapp context)', () => {
    it('fills its positioned ancestor edge-to-edge without hardcoded offsets', () => {
      const { result } = renderHook(() =>
        useHarness({ isInNode: false, clientHeight: 400 }),
      )

      act(() => {
        result.current.setIsExpand(true)
      })

      // The expanded panel must fill the nearest positioned ancestor entirely
      // (absolute + inset-0). Previously it used hardcoded `top-[52px]` which
      // assumed a 52px header that does not exist in the conversation-log
      // layout, causing the expanded panel to overlap the status bar above
      // the editor (#34887).
      expect(result.current.wrapClassName).toContain('absolute')
      expect(result.current.wrapClassName).toContain('inset-0')
      expect(result.current.wrapClassName).not.toMatch(/top-\[\d+px\]/)
      expect(result.current.wrapClassName).not.toMatch(/left-\d+/)
      expect(result.current.wrapClassName).not.toMatch(/right-\d+/)
      expect(result.current.wrapClassName).toContain('bg-components-panel-bg')
    })
  })

  describe('expanded state height math', () => {
    it('subtracts the 29px chrome when hasFooter is false', () => {
      const { result } = renderHook(() =>
        useHarness({ hasFooter: false, clientHeight: 400 }),
      )

      act(() => {
        result.current.setIsExpand(true)
      })

      // 400 (clientHeight) - 29 (title bar) = 371
      expect(result.current.editorExpandHeight).toBe(371)
    })

    it('subtracts the 56px chrome when hasFooter is true', () => {
      const { result } = renderHook(() =>
        useHarness({ hasFooter: true, clientHeight: 400 }),
      )

      act(() => {
        result.current.setIsExpand(true)
      })

      // 400 (clientHeight) - 56 (title bar + footer) = 344
      expect(result.current.editorExpandHeight).toBe(344)
    })

    it('never returns a negative height even if chrome exceeds wrap', () => {
      const { result } = renderHook(() =>
        useHarness({ hasFooter: true, clientHeight: 20 }),
      )

      act(() => {
        result.current.setIsExpand(true)
      })

      // 20 - 56 would be -36; clamped to 0.
      expect(result.current.editorExpandHeight).toBe(0)
    })
  })
})
