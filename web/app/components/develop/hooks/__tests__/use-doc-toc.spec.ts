import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDocToc } from '../use-doc-toc'

describe('useDocToc', () => {
  const defaultOptions = { appDetail: { mode: 'chat' }, locale: 'en-US' }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    })
  })

  describe('initial state', () => {
    it('should set isTocExpanded to false on narrow viewport', () => {
      const { result } = renderHook(() => useDocToc(defaultOptions))

      expect(result.current.isTocExpanded).toBe(false)
      expect(result.current.toc).toEqual([])
      expect(result.current.activeSection).toBe('')
    })

    it('should set isTocExpanded to true on wide viewport', () => {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: vi.fn().mockReturnValue({ matches: true }),
      })

      const { result } = renderHook(() => useDocToc(defaultOptions))

      expect(result.current.isTocExpanded).toBe(true)
    })
  })

  describe('toc extraction', () => {
    it('should extract toc items from article h2 anchors', async () => {
      vi.useFakeTimers()
      const article = document.createElement('article')
      const heading = document.createElement('h2')
      const anchor = document.createElement('a')
      anchor.href = '#section-1'
      anchor.textContent = 'Section 1'
      heading.appendChild(anchor)
      article.appendChild(heading)
      document.body.appendChild(article)

      const { result } = renderHook(() => useDocToc(defaultOptions))

      await act(async () => {
        vi.runAllTimers()
      })

      expect(result.current.toc).toEqual([{ href: '#section-1', text: 'Section 1' }])
      expect(result.current.activeSection).toBe('section-1')

      document.body.removeChild(article)
      vi.useRealTimers()
    })

    it('should re-extract toc when dependencies change', async () => {
      vi.useFakeTimers()
      const article = document.createElement('article')
      document.body.appendChild(article)
      const { result, rerender } = renderHook(props => useDocToc(props), {
        initialProps: defaultOptions,
      })

      await act(async () => {
        vi.runAllTimers()
      })
      expect(result.current.toc).toEqual([])

      const heading = document.createElement('h2')
      const anchor = document.createElement('a')
      anchor.href = '#new-section'
      anchor.textContent = 'New Section'
      heading.appendChild(anchor)
      article.appendChild(heading)

      rerender({ appDetail: { mode: 'workflow' }, locale: 'zh-Hans' })

      await act(async () => {
        vi.runAllTimers()
      })

      expect(result.current.toc).toEqual([{ href: '#new-section', text: 'New Section' }])

      document.body.removeChild(article)
      vi.useRealTimers()
    })
  })

  it('should update active section on scroll', async () => {
    vi.useFakeTimers()
    const article = document.createElement('article')
    const scrollContainer = document.createElement('div')
    scrollContainer.className = 'overflow-auto'
    document.body.appendChild(scrollContainer)
    document.body.appendChild(article)

    const heading = document.createElement('h2')
    const anchor = document.createElement('a')
    anchor.href = '#target-section'
    anchor.textContent = 'Target'
    heading.appendChild(anchor)
    article.appendChild(heading)

    const target = document.createElement('div')
    target.id = 'target-section'
    target.getBoundingClientRect = vi.fn(() => ({
      top: 10,
      bottom: 100,
      left: 0,
      right: 0,
      width: 0,
      height: 90,
      x: 0,
      y: 10,
      toJSON: () => ({}),
    }))
    scrollContainer.appendChild(target)

    const addEventListenerSpy = vi.spyOn(scrollContainer, 'addEventListener')
    const { result } = renderHook(() => useDocToc(defaultOptions))

    await act(async () => {
      vi.runAllTimers()
    })

    const handleScroll = addEventListenerSpy.mock.calls.find(call => call[0] === 'scroll')?.[1] as EventListener
    act(() => {
      handleScroll(new Event('scroll'))
    })

    expect(result.current.activeSection).toBe('target-section')

    document.body.removeChild(scrollContainer)
    document.body.removeChild(article)
    vi.useRealTimers()
  })

  it('should smooth scroll to target on toc click', () => {
    const scrollContainer = document.createElement('div')
    scrollContainer.className = 'overflow-auto'
    scrollContainer.scrollTo = vi.fn()
    document.body.appendChild(scrollContainer)

    const target = document.createElement('div')
    target.id = 'target-section'
    Object.defineProperty(target, 'offsetTop', { value: 500 })
    scrollContainer.appendChild(target)

    const { result } = renderHook(() => useDocToc(defaultOptions))
    const preventDefault = vi.fn()

    act(() => {
      result.current.handleTocClick({ preventDefault } as unknown as React.MouseEvent<HTMLAnchorElement>, {
        href: '#target-section',
        text: 'Target',
      })
    })

    expect(preventDefault).toHaveBeenCalled()
    expect(scrollContainer.scrollTo).toHaveBeenCalledWith({
      top: 420,
      behavior: 'smooth',
    })

    document.body.removeChild(scrollContainer)
  })
})
