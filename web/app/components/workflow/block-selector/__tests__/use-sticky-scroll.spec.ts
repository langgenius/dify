import { act, renderHook } from '@testing-library/react'
import useStickyScroll, { ScrollPosition } from '../use-sticky-scroll'

it('updates sticky position across both wrapper boundaries as scrolling changes', () => {
  vi.useFakeTimers()
  try {
    const wrapper = document.createElement('div')
    const next = document.createElement('div')
    wrapper.getBoundingClientRect = () => new DOMRect(0, 100, 100, 200)
    let top = 320
    next.getBoundingClientRect = () => new DOMRect(0, top, 100, 20)
    const { result } = renderHook(() =>
      useStickyScroll({
        wrapElemRef: { current: wrapper },
        nextToStickyELemRef: { current: next },
      }),
    )
    for (const [position, expected] of [
      [320, ScrollPosition.belowTheWrap],
      [220, ScrollPosition.showing],
      [100, ScrollPosition.aboveTheWrap],
      [101, ScrollPosition.showing],
      [300, ScrollPosition.belowTheWrap],
    ] as const) {
      top = position
      act(() => {
        result.current.handleScroll()
        vi.advanceTimersByTime(100)
      })
      expect(result.current.scrollPosition).toBe(expected)
    }
  } finally {
    vi.useRealTimers()
  }
})
