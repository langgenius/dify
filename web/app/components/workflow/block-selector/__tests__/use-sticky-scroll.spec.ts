import type * as React from 'react'
import { act, renderHook } from '@testing-library/react'
import useStickyScroll, { ScrollPosition } from '../use-sticky-scroll'

const setRect = (element: HTMLElement, top: number, height: number) => {
  element.getBoundingClientRect = vi.fn(() => new DOMRect(0, top, 100, height))
}

describe('useStickyScroll', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const runScroll = (handleScroll: () => void) => {
    act(() => {
      handleScroll()
      vi.advanceTimersByTime(120)
    })
  }

  it('should keep the default state when refs are missing', () => {
    const wrapElemRef = { current: null } as React.RefObject<HTMLElement | null>
    const nextToStickyELemRef = { current: null } as React.RefObject<HTMLElement | null>

    const { result } = renderHook(() =>
      useStickyScroll({
        wrapElemRef,
        nextToStickyELemRef,
      }),
    )

    runScroll(result.current.handleScroll)

    expect(result.current.scrollPosition).toBe(ScrollPosition.belowTheWrap)
  })

  it('should mark the sticky element as below the wrapper when it is outside the visible area', () => {
    const wrapElement = document.createElement('div')
    const nextElement = document.createElement('div')
    setRect(wrapElement, 100, 200)
    setRect(nextElement, 320, 20)

    const wrapElemRef = { current: wrapElement } as React.RefObject<HTMLElement | null>
    const nextToStickyELemRef = { current: nextElement } as React.RefObject<HTMLElement | null>

    const { result } = renderHook(() =>
      useStickyScroll({
        wrapElemRef,
        nextToStickyELemRef,
      }),
    )

    runScroll(result.current.handleScroll)

    expect(result.current.scrollPosition).toBe(ScrollPosition.belowTheWrap)
  })

  it('should mark the sticky element as showing when it is within the wrapper', () => {
    const wrapElement = document.createElement('div')
    const nextElement = document.createElement('div')
    setRect(wrapElement, 100, 200)
    setRect(nextElement, 220, 20)

    const wrapElemRef = { current: wrapElement } as React.RefObject<HTMLElement | null>
    const nextToStickyELemRef = { current: nextElement } as React.RefObject<HTMLElement | null>

    const { result } = renderHook(() =>
      useStickyScroll({
        wrapElemRef,
        nextToStickyELemRef,
      }),
    )

    runScroll(result.current.handleScroll)

    expect(result.current.scrollPosition).toBe(ScrollPosition.showing)
  })

  it('should mark the sticky element as above the wrapper when it has scrolled past the top', () => {
    const wrapElement = document.createElement('div')
    const nextElement = document.createElement('div')
    setRect(wrapElement, 100, 200)
    setRect(nextElement, 90, 20)

    const wrapElemRef = { current: wrapElement } as React.RefObject<HTMLElement | null>
    const nextToStickyELemRef = { current: nextElement } as React.RefObject<HTMLElement | null>

    const { result } = renderHook(() =>
      useStickyScroll({
        wrapElemRef,
        nextToStickyELemRef,
      }),
    )

    runScroll(result.current.handleScroll)

    expect(result.current.scrollPosition).toBe(ScrollPosition.aboveTheWrap)
  })
})
