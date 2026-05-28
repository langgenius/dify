import type { ChatItem } from '../../types'
import { act, fireEvent, render, screen } from '@testing-library/react'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { useChatLayout } from '../use-chat-layout'

type ResizeCallback = (entries: ResizeObserverEntry[], observer: ResizeObserver) => void

let capturedResizeCallbacks: ResizeCallback[] = []
let disconnectSpy: ReturnType<typeof vi.fn>
let rafCallbacks: FrameRequestCallback[] = []

const makeChatItem = (overrides: Partial<ChatItem> = {}): ChatItem => ({
  id: `item-${Math.random().toString(36).slice(2)}`,
  content: 'Test content',
  isAnswer: false,
  ...overrides,
})

const makeResizeEntry = (blockSize: number, inlineSize: number): ResizeObserverEntry => ({
  borderBoxSize: [{ blockSize, inlineSize } as ResizeObserverSize],
  contentBoxSize: [{ blockSize, inlineSize } as ResizeObserverSize],
  contentRect: new DOMRect(0, 0, inlineSize, blockSize),
  devicePixelContentBoxSize: [{ blockSize, inlineSize } as ResizeObserverSize],
  target: document.createElement('div'),
})

const assignMetric = (node: HTMLElement, key: 'clientWidth' | 'clientHeight' | 'scrollHeight', value: number) => {
  Object.defineProperty(node, key, {
    configurable: true,
    value,
  })
}

const LayoutHarness = ({
  chatList,
  sidebarCollapseState,
  attachRefs = true,
}: {
  chatList: ChatItem[]
  sidebarCollapseState?: boolean
  attachRefs?: boolean
}) => {
  const {
    width,
    chatContainerRef,
    chatContainerInnerRef,
    chatFooterRef,
    chatFooterInnerRef,
  } = useChatLayout({ chatList, sidebarCollapseState })

  return (
    <>
      <div
        data-testid="chat-container"
        ref={(node) => {
          chatContainerRef.current = attachRefs ? node : null
          if (node && attachRefs) {
            assignMetric(node, 'clientWidth', 400)
            assignMetric(node, 'clientHeight', 240)
            assignMetric(node, 'scrollHeight', 640)
            if (!node.dataset.metricsReady) {
              node.scrollTop = 0
              node.dataset.metricsReady = 'true'
            }
          }
        }}
      >
        <div
          data-testid="chat-container-inner"
          ref={(node) => {
            chatContainerInnerRef.current = attachRefs ? node : null
            if (node && attachRefs)
              assignMetric(node, 'clientWidth', 360)
          }}
        />
      </div>
      <div
        data-testid="chat-footer"
        ref={(node) => {
          chatFooterRef.current = attachRefs ? node : null
        }}
      >
        <div
          data-testid="chat-footer-inner"
          ref={(node) => {
            chatFooterInnerRef.current = attachRefs ? node : null
          }}
        />
      </div>
      <output data-testid="layout-width">{width}</output>
    </>
  )
}

const flushAnimationFrames = () => {
  const queuedCallbacks = [...rafCallbacks]
  rafCallbacks = []
  queuedCallbacks.forEach(callback => callback(0))
}

describe('useChatLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    capturedResizeCallbacks = []
    disconnectSpy = vi.fn()
    rafCallbacks = []

    Object.defineProperty(document.body, 'clientWidth', {
      configurable: true,
      value: 1024,
    })

    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb)
      return rafCallbacks.length
    })

    vi.stubGlobal('ResizeObserver', class {
      constructor(cb: ResizeCallback) {
        capturedResizeCallbacks.push(cb)
      }

      observe() { }
      unobserve() { }
      disconnect = disconnectSpy
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  // The hook should compute shell dimensions and auto-scroll when enough chat items exist.
  describe('Layout Calculation', () => {
    it('should auto-scroll and compute the chat shell widths on mount', () => {
      const addSpy = vi.spyOn(window, 'addEventListener')

      render(
        <LayoutHarness
          chatList={[
            makeChatItem({ id: 'q1' }),
            makeChatItem({ id: 'a1', isAnswer: true }),
          ]}
          sidebarCollapseState={false}
        />,
      )

      act(() => {
        flushAnimationFrames()
        vi.runAllTimers()
      })

      expect(screen.getByTestId('layout-width')).toHaveTextContent('600')
      expect(screen.getByTestId('chat-footer').style.width).toBe('400px')
      expect(screen.getByTestId('chat-footer-inner').style.width).toBe('360px')
      expect((screen.getByTestId('chat-container') as HTMLDivElement).scrollTop).toBe(640)
      expect(addSpy).toHaveBeenCalledWith('resize', expect.any(Function))
    })
  })

  // Resize observers should keep padding and widths in sync, then fully clean up on unmount.
  describe('Resize Observers', () => {
    it('should react to observer updates and disconnect both observers on unmount', () => {
      const removeSpy = vi.spyOn(window, 'removeEventListener')
      const { unmount } = render(
        <LayoutHarness
          chatList={[
            makeChatItem({ id: 'q1' }),
            makeChatItem({ id: 'a1', isAnswer: true }),
          ]}
        />,
      )

      act(() => {
        capturedResizeCallbacks[0]?.([makeResizeEntry(80, 400)], {} as ResizeObserver)
        flushAnimationFrames()
      })
      expect(screen.getByTestId('chat-container').style.paddingBottom).toBe('80px')

      act(() => {
        capturedResizeCallbacks[1]?.([makeResizeEntry(50, 560)], {} as ResizeObserver)
        flushAnimationFrames()
      })
      expect(screen.getByTestId('chat-footer').style.width).toBe('560px')

      unmount()

      expect(removeSpy).toHaveBeenCalledWith('resize', expect.any(Function))
      expect(disconnectSpy).toHaveBeenCalledTimes(2)
    })

    it('should respect manual scrolling until a new first message arrives and safely ignore missing refs', () => {
      const { rerender } = render(
        <LayoutHarness
          chatList={[
            makeChatItem({ id: 'q1' }),
            makeChatItem({ id: 'a1', isAnswer: true }),
          ]}
        />,
      )

      const container = screen.getByTestId('chat-container') as HTMLDivElement

      act(() => {
        fireEvent.scroll(container)
        flushAnimationFrames()
      })

      act(() => {
        container.scrollTop = 10
        fireEvent.scroll(container)
      })

      rerender(
        <LayoutHarness
          chatList={[
            makeChatItem({ id: 'q1' }),
            makeChatItem({ id: 'a1', isAnswer: true }),
            makeChatItem({ id: 'a2', isAnswer: true }),
          ]}
        />,
      )

      act(() => {
        flushAnimationFrames()
        vi.runAllTimers()
      })

      act(() => {
        container.scrollTop = 420
        fireEvent.scroll(container)
      })

      rerender(
        <LayoutHarness
          chatList={[
            makeChatItem({ id: 'q2' }),
            makeChatItem({ id: 'a3', isAnswer: true }),
          ]}
        />,
      )

      act(() => {
        flushAnimationFrames()
        vi.runAllTimers()
      })

      expect(container.scrollTop).toBe(640)

      rerender(
        <LayoutHarness
          chatList={[
            makeChatItem({ id: 'q2' }),
            makeChatItem({ id: 'a3', isAnswer: true }),
          ]}
          attachRefs={false}
        />,
      )

      act(() => {
        fireEvent.scroll(container)
        flushAnimationFrames()
      })
    })

    it('should keep the hook stable when the DOM refs are not attached', () => {
      render(
        <LayoutHarness
          chatList={[makeChatItem({ id: 'q1' })]}
          sidebarCollapseState={true}
          attachRefs={false}
        />,
      )

      act(() => {
        flushAnimationFrames()
        vi.runAllTimers()
      })

      expect(screen.getByTestId('layout-width')).toHaveTextContent('0')
      expect(capturedResizeCallbacks).toHaveLength(0)
      expect(screen.getByTestId('chat-footer').style.width).toBe('')
      expect(screen.getByTestId('chat-footer-inner').style.width).toBe('')
    })
  })
})
