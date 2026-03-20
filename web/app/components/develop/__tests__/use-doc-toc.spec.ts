import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDocToc } from '../hooks/use-doc-toc'

/**
 * Unit tests for the useDocToc custom hook.
 * Covers TOC extraction, viewport-based expansion, scroll tracking, and click handling.
 */
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

  // Covers initial state values based on viewport width
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

  // Covers TOC extraction from DOM article headings
  describe('TOC extraction', () => {
    it('should extract toc items from article h2 anchors', async () => {
      vi.useFakeTimers()
      const article = document.createElement('article')
      const h2 = document.createElement('h2')
      const anchor = document.createElement('a')
      anchor.href = '#section-1'
      anchor.textContent = 'Section 1'
      h2.appendChild(anchor)
      article.appendChild(h2)
      document.body.appendChild(article)

      const { result } = renderHook(() => useDocToc(defaultOptions))

      await act(async () => {
        vi.runAllTimers()
      })

      expect(result.current.toc).toEqual([
        { href: '#section-1', text: 'Section 1' },
      ])
      expect(result.current.activeSection).toBe('section-1')

      document.body.removeChild(article)
      vi.useRealTimers()
    })

    it('should return empty toc when no article exists', async () => {
      vi.useFakeTimers()
      const { result } = renderHook(() => useDocToc(defaultOptions))

      await act(async () => {
        vi.runAllTimers()
      })

      expect(result.current.toc).toEqual([])
      expect(result.current.activeSection).toBe('')
      vi.useRealTimers()
    })

    it('should skip h2 headings without anchors', async () => {
      vi.useFakeTimers()
      const article = document.createElement('article')
      const h2NoAnchor = document.createElement('h2')
      h2NoAnchor.textContent = 'No Anchor'
      article.appendChild(h2NoAnchor)

      const h2WithAnchor = document.createElement('h2')
      const anchor = document.createElement('a')
      anchor.href = '#valid'
      anchor.textContent = 'Valid'
      h2WithAnchor.appendChild(anchor)
      article.appendChild(h2WithAnchor)

      document.body.appendChild(article)

      const { result } = renderHook(() => useDocToc(defaultOptions))

      await act(async () => {
        vi.runAllTimers()
      })

      expect(result.current.toc).toHaveLength(1)
      expect(result.current.toc[0]).toEqual({ href: '#valid', text: 'Valid' })

      document.body.removeChild(article)
      vi.useRealTimers()
    })

    it('should re-extract toc when appDetail changes', async () => {
      vi.useFakeTimers()
      const article = document.createElement('article')
      document.body.appendChild(article)

      const { result, rerender } = renderHook(
        props => useDocToc(props),
        { initialProps: defaultOptions },
      )

      await act(async () => {
        vi.runAllTimers()
      })

      expect(result.current.toc).toEqual([])

      // Add a heading, then change appDetail to trigger re-extraction
      const h2 = document.createElement('h2')
      const anchor = document.createElement('a')
      anchor.href = '#new-section'
      anchor.textContent = 'New Section'
      h2.appendChild(anchor)
      article.appendChild(h2)

      rerender({ appDetail: { mode: 'workflow' }, locale: 'en-US' })

      await act(async () => {
        vi.runAllTimers()
      })

      expect(result.current.toc).toHaveLength(1)

      document.body.removeChild(article)
      vi.useRealTimers()
    })

    it('should re-extract toc when locale changes', async () => {
      vi.useFakeTimers()
      const article = document.createElement('article')
      const h2 = document.createElement('h2')
      const anchor = document.createElement('a')
      anchor.href = '#sec'
      anchor.textContent = 'Sec'
      h2.appendChild(anchor)
      article.appendChild(h2)
      document.body.appendChild(article)

      const { result, rerender } = renderHook(
        props => useDocToc(props),
        { initialProps: defaultOptions },
      )

      await act(async () => {
        vi.runAllTimers()
      })

      expect(result.current.toc).toHaveLength(1)

      rerender({ appDetail: defaultOptions.appDetail, locale: 'zh-Hans' })

      await act(async () => {
        vi.runAllTimers()
      })

      // Should still have the toc item after re-extraction
      expect(result.current.toc).toHaveLength(1)

      document.body.removeChild(article)
      vi.useRealTimers()
    })
  })

  // Covers manual toggle via setIsTocExpanded
  describe('setIsTocExpanded', () => {
    it('should toggle isTocExpanded state', () => {
      const { result } = renderHook(() => useDocToc(defaultOptions))

      expect(result.current.isTocExpanded).toBe(false)

      act(() => {
        result.current.setIsTocExpanded(true)
      })

      expect(result.current.isTocExpanded).toBe(true)

      act(() => {
        result.current.setIsTocExpanded(false)
      })

      expect(result.current.isTocExpanded).toBe(false)
    })
  })

  // Covers smooth-scroll click handler
  describe('handleTocClick', () => {
    it('should prevent default and scroll to target element', () => {
      const scrollContainer = document.createElement('div')
      scrollContainer.className = 'overflow-auto'
      scrollContainer.scrollTo = vi.fn()
      document.body.appendChild(scrollContainer)

      const target = document.createElement('div')
      target.id = 'target-section'
      Object.defineProperty(target, 'offsetTop', { value: 500 })
      scrollContainer.appendChild(target)

      const { result } = renderHook(() => useDocToc(defaultOptions))

      const mockEvent = { preventDefault: vi.fn() } as unknown as React.MouseEvent<HTMLAnchorElement>
      act(() => {
        result.current.handleTocClick(mockEvent, { href: '#target-section', text: 'Target' })
      })

      expect(mockEvent.preventDefault).toHaveBeenCalled()
      expect(scrollContainer.scrollTo).toHaveBeenCalledWith({
        top: 420, // 500 - 80 (HEADER_OFFSET)
        behavior: 'smooth',
      })

      document.body.removeChild(scrollContainer)
    })

    it('should do nothing when target element does not exist', () => {
      const { result } = renderHook(() => useDocToc(defaultOptions))

      const mockEvent = { preventDefault: vi.fn() } as unknown as React.MouseEvent<HTMLAnchorElement>
      act(() => {
        result.current.handleTocClick(mockEvent, { href: '#nonexistent', text: 'Missing' })
      })

      expect(mockEvent.preventDefault).toHaveBeenCalled()
    })
  })

  // Covers scroll-based active section tracking
  describe('scroll tracking', () => {
    // Helper: set up DOM with scroll container, article headings, and matching target elements
    const setupScrollDOM = (sections: Array<{ id: string, text: string, top: number }>) => {
      const scrollContainer = document.createElement('div')
      scrollContainer.className = 'overflow-auto'
      document.body.appendChild(scrollContainer)

      const article = document.createElement('article')
      sections.forEach(({ id, text, top }) => {
        // Heading with anchor for TOC extraction
        const h2 = document.createElement('h2')
        const anchor = document.createElement('a')
        anchor.href = `#${id}`
        anchor.textContent = text
        h2.appendChild(anchor)
        article.appendChild(h2)

        // Target element for scroll tracking
        const target = document.createElement('div')
        target.id = id
        target.getBoundingClientRect = vi.fn().mockReturnValue({ top })
        scrollContainer.appendChild(target)
      })
      document.body.appendChild(article)

      return {
        scrollContainer,
        article,
        cleanup: () => {
          document.body.removeChild(scrollContainer)
          document.body.removeChild(article)
        },
      }
    }

    it('should register scroll listener when toc has items', async () => {
      vi.useFakeTimers()
      const { scrollContainer, cleanup } = setupScrollDOM([
        { id: 'sec-a', text: 'Section A', top: 0 },
      ])
      const addSpy = vi.spyOn(scrollContainer, 'addEventListener')
      const removeSpy = vi.spyOn(scrollContainer, 'removeEventListener')

      const { unmount } = renderHook(() => useDocToc(defaultOptions))

      await act(async () => {
        vi.runAllTimers()
      })

      expect(addSpy).toHaveBeenCalledWith('scroll', expect.any(Function))

      unmount()

      expect(removeSpy).toHaveBeenCalledWith('scroll', expect.any(Function))

      cleanup()
      vi.useRealTimers()
    })

    it('should update activeSection when scrolling past a section', async () => {
      vi.useFakeTimers()
      // innerHeight/2 = 384 in jsdom (default 768), so top <= 384 means "scrolled past"
      const { scrollContainer, cleanup } = setupScrollDOM([
        { id: 'intro', text: 'Intro', top: 100 },
        { id: 'details', text: 'Details', top: 600 },
      ])

      const { result } = renderHook(() => useDocToc(defaultOptions))

      // Extract TOC items
      await act(async () => {
        vi.runAllTimers()
      })

      expect(result.current.toc).toHaveLength(2)
      expect(result.current.activeSection).toBe('intro')

      // Fire scroll — 'intro' (top=100) is above midpoint, 'details' (top=600) is below
      await act(async () => {
        scrollContainer.dispatchEvent(new Event('scroll'))
      })

      expect(result.current.activeSection).toBe('intro')

      cleanup()
      vi.useRealTimers()
    })

    it('should track the last section above the viewport midpoint', async () => {
      vi.useFakeTimers()
      const { scrollContainer, cleanup } = setupScrollDOM([
        { id: 'sec-1', text: 'Section 1', top: 50 },
        { id: 'sec-2', text: 'Section 2', top: 200 },
        { id: 'sec-3', text: 'Section 3', top: 800 },
      ])

      const { result } = renderHook(() => useDocToc(defaultOptions))

      await act(async () => {
        vi.runAllTimers()
      })

      // Fire scroll — sec-1 (top=50) and sec-2 (top=200) are above midpoint (384),
      // sec-3 (top=800) is below. The last one above midpoint wins.
      await act(async () => {
        scrollContainer.dispatchEvent(new Event('scroll'))
      })

      expect(result.current.activeSection).toBe('sec-2')

      cleanup()
      vi.useRealTimers()
    })

    it('should not update activeSection when no section is above midpoint', async () => {
      vi.useFakeTimers()
      const { scrollContainer, cleanup } = setupScrollDOM([
        { id: 'far-away', text: 'Far Away', top: 1000 },
      ])

      const { result } = renderHook(() => useDocToc(defaultOptions))

      await act(async () => {
        vi.runAllTimers()
      })

      // Initial activeSection is set by extraction
      const initialSection = result.current.activeSection

      await act(async () => {
        scrollContainer.dispatchEvent(new Event('scroll'))
      })

      // Should not change since the element is below midpoint
      expect(result.current.activeSection).toBe(initialSection)

      cleanup()
      vi.useRealTimers()
    })

    it('should handle elements not found in DOM during scroll', async () => {
      vi.useFakeTimers()
      const scrollContainer = document.createElement('div')
      scrollContainer.className = 'overflow-auto'
      document.body.appendChild(scrollContainer)

      // Article with heading but NO matching target element by id
      const article = document.createElement('article')
      const h2 = document.createElement('h2')
      const anchor = document.createElement('a')
      anchor.href = '#missing-target'
      anchor.textContent = 'Missing'
      h2.appendChild(anchor)
      article.appendChild(h2)
      document.body.appendChild(article)

      const { result } = renderHook(() => useDocToc(defaultOptions))

      await act(async () => {
        vi.runAllTimers()
      })

      const initialSection = result.current.activeSection

      // Scroll fires but getElementById returns null — no crash, no change
      await act(async () => {
        scrollContainer.dispatchEvent(new Event('scroll'))
      })

      expect(result.current.activeSection).toBe(initialSection)

      document.body.removeChild(scrollContainer)
      document.body.removeChild(article)
      vi.useRealTimers()
    })
  })
})
