import type { ChatConfig, ChatItem, OnSend } from '../types'
import type { ChatProps } from './index'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore as useAppStore } from '@/app/components/app/store'
import Chat from './index'

vi.mock('./context', () => ({
  ChatContextProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('./answer', () => ({
  default: ({ item, responding }: { item: ChatItem, responding?: boolean }) => (
    <div data-testid="answer-item" data-id={item.id} data-responding={String(!!responding)}>
      {item.content}
    </div>
  ),
}))

vi.mock('./question', () => ({
  default: ({ item }: { item: ChatItem }) => (
    <div data-testid="question-item" data-id={item.id}>{item.content}</div>
  ),
}))

vi.mock('./try-to-ask', () => ({
  default: ({ suggestedQuestions }: { suggestedQuestions: string[] }) => (
    <div data-testid="try-to-ask">{suggestedQuestions.join(',')}</div>
  ),
}))

vi.mock('./chat-input-area', () => ({
  default: ({ disabled }: { disabled?: boolean }) => (
    <div data-testid="chat-input-area" data-disabled={String(!!disabled)} />
  ),
}))

vi.mock('@/app/components/base/prompt-log-modal', () => ({
  default: ({ onCancel }: { onCancel: () => void }) => (
    <div data-testid="prompt-log-modal">
      <button data-testid="prompt-log-cancel" onClick={onCancel}>cancel</button>
    </div>
  ),
}))

vi.mock('@/app/components/base/agent-log-modal', () => ({
  default: ({ onCancel }: { onCancel: () => void }) => (
    <div data-testid="agent-log-modal">
      <button data-testid="agent-log-cancel" onClick={onCancel}>cancel</button>
    </div>
  ),
}))

vi.mock('es-toolkit/compat', () => ({
  debounce: (fn: (...args: unknown[]) => void) => {
    const debounced = (...args: unknown[]) => fn(...args)
    debounced.cancel = vi.fn()
    return debounced
  },
}))

type ResizeCallback = (entries: ResizeObserverEntry[], observer: ResizeObserver) => void
let capturedResizeCallbacks: ResizeCallback[] = []

const makeResizeEntry = (blockSize: number, inlineSize: number): ResizeObserverEntry => ({
  borderBoxSize: [{ blockSize, inlineSize } as ResizeObserverSize],
  contentBoxSize: [{ blockSize, inlineSize } as ResizeObserverSize],
  contentRect: new DOMRect(0, 0, inlineSize, blockSize),
  devicePixelContentBoxSize: [{ blockSize, inlineSize } as ResizeObserverSize],
  target: document.createElement('div'),
})

const makeChatItem = (overrides: Partial<ChatItem> = {}): ChatItem => ({
  id: `item-${Math.random()}`,
  content: 'Test content',
  isAnswer: false,
  ...overrides,
})

const mockSetCurrentLogItem = vi.fn()
const mockSetShowPromptLogModal = vi.fn()
const mockSetShowAgentLogModal = vi.fn()
const mockSetAppDetail = vi.fn()
const mockSetAppSidebarExpand = vi.fn()
const mockSetCurrentLogModalActiveTab = vi.fn()
const mockSetShowMessageLogModal = vi.fn()
const mockSetShowAppConfigureFeaturesModal = vi.fn()

const defaultStoreState = {
  appDetail: undefined,
  appSidebarExpand: '',
  currentLogItem: undefined,
  currentLogModalActiveTab: 'DETAIL',
  showPromptLogModal: false,
  showAgentLogModal: false,
  showMessageLogModal: false,
  showAppConfigureFeaturesModal: false,
  setAppDetail: mockSetAppDetail,
  setAppSidebarExpand: mockSetAppSidebarExpand,
  setCurrentLogItem: mockSetCurrentLogItem,
  setCurrentLogModalActiveTab: mockSetCurrentLogModalActiveTab,
  setShowPromptLogModal: mockSetShowPromptLogModal,
  setShowAgentLogModal: mockSetShowAgentLogModal,
  setShowMessageLogModal: mockSetShowMessageLogModal,
  setShowAppConfigureFeaturesModal: mockSetShowAppConfigureFeaturesModal,
}

const defaultProps: Partial<ChatProps> = {
  chatList: [],
}

const renderChat = (props: Partial<ChatProps> = {}) =>
  render(<Chat chatList={[]} {...defaultProps} {...props} />)

describe('Chat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedResizeCallbacks = []

    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 0
    })

    vi.stubGlobal('ResizeObserver', class {
      private cb: ResizeCallback
      constructor(cb: ResizeCallback) {
        this.cb = cb
        capturedResizeCallbacks.push(cb)
      }

      observe() { }
      unobserve() { }
      disconnect() { }
    })

    useAppStore.setState(defaultStoreState)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('Rendering', () => {
    it('should render without crashing with an empty chatList', () => {
      renderChat()
      expect(screen.getByTestId('chat-root')).toBeInTheDocument()
    })

    it('should render chatNode content when chatNode prop is provided', () => {
      renderChat({ chatNode: <div data-testid="custom-chat-node">node content</div> })
      expect(screen.getByTestId('custom-chat-node')).toBeInTheDocument()
    })

    it('should apply isTryApp flex-col class when isTryApp=true', () => {
      renderChat({ isTryApp: true })
      expect(screen.getByTestId('chat-root')).toHaveClass('flex', 'flex-col')
    })

    it('should not apply flex-col when isTryApp is falsy', () => {
      renderChat({ isTryApp: false })
      expect(screen.getByTestId('chat-root')).not.toHaveClass('flex-col')
    })

    it('should apply custom chatContainerClassName to the scroll container', () => {
      renderChat({ chatContainerClassName: 'my-container-class' })
      expect(screen.getByTestId('chat-container')).toHaveClass('my-container-class')
    })

    it('should render the chat container and footer', () => {
      renderChat()
      expect(screen.getByTestId('chat-container')).toBeInTheDocument()
      expect(screen.getByTestId('chat-footer')).toBeInTheDocument()
    })
  })

  describe('Chat List – Answer and Question Items', () => {
    it('should render a Question component for non-answer items', () => {
      renderChat({ chatList: [makeChatItem({ id: 'q1', isAnswer: false })] })
      expect(screen.getByTestId('question-item')).toBeInTheDocument()
    })

    it('should render an Answer component for answer items', () => {
      renderChat({ chatList: [makeChatItem({ id: 'a1', isAnswer: true })] })
      expect(screen.getByTestId('answer-item')).toBeInTheDocument()
    })

    it('should render both Question and Answer items from a mixed chatList', () => {
      renderChat({
        chatList: [
          makeChatItem({ id: 'q1', isAnswer: false }),
          makeChatItem({ id: 'a1', isAnswer: true }),
        ],
      })
      expect(screen.getByTestId('question-item')).toBeInTheDocument()
      expect(screen.getByTestId('answer-item')).toBeInTheDocument()
    })

    it('should pass responding=true only to the last answer when isResponding=true', () => {
      renderChat({
        isResponding: true,
        chatList: [
          makeChatItem({ id: 'q1', isAnswer: false }),
          makeChatItem({ id: 'a1', isAnswer: true }),
          makeChatItem({ id: 'q2', isAnswer: false }),
          makeChatItem({ id: 'a2', isAnswer: true }),
        ],
      })
      const answers = screen.getAllByTestId('answer-item')
      expect(answers[0]).toHaveAttribute('data-responding', 'false')
      expect(answers[1]).toHaveAttribute('data-responding', 'true')
    })

    it('should pass responding=false to all answers when isResponding=false', () => {
      renderChat({
        isResponding: false,
        chatList: [
          makeChatItem({ id: 'a1', isAnswer: true }),
          makeChatItem({ id: 'a2', isAnswer: true }),
        ],
      })
      screen.getAllByTestId('answer-item').forEach(el =>
        expect(el).toHaveAttribute('data-responding', 'false'),
      )
    })

    it('should render answer content text', () => {
      renderChat({ chatList: [makeChatItem({ id: 'a1', isAnswer: true, content: 'Hello world' })] })
      expect(screen.getByTestId('answer-item')).toHaveTextContent('Hello world')
    })
  })

  describe('Stop Responding Button', () => {
    it('should show the stop button when isResponding=true and noStopResponding is falsy', () => {
      renderChat({ isResponding: true, noStopResponding: false })
      expect(screen.getByTestId('stop-responding-container')).toBeInTheDocument()
    })

    it('should hide the stop button when noStopResponding=true', () => {
      renderChat({ isResponding: true, noStopResponding: true })
      expect(screen.queryByTestId('stop-responding-container')).not.toBeInTheDocument()
    })

    it('should hide the stop button when isResponding=false', () => {
      renderChat({ isResponding: false, noStopResponding: false })
      expect(screen.queryByTestId('stop-responding-container')).not.toBeInTheDocument()
    })

    it('should call onStopResponding when the stop button is clicked', async () => {
      const user = userEvent.setup()
      const onStopResponding = vi.fn()
      renderChat({ isResponding: true, noStopResponding: false, onStopResponding })

      await user.click(screen.getByText(/stopResponding/i))

      expect(onStopResponding).toHaveBeenCalledTimes(1)
    })

    it('should display the stopResponding i18n key text', () => {
      renderChat({ isResponding: true, noStopResponding: false })
      expect(screen.getByText(/stopResponding/i)).toBeInTheDocument()
    })
  })

  describe('TryToAsk', () => {
    const tryToAskConfig = {
      suggested_questions_after_answer: { enabled: true },
    } as unknown as ChatConfig

    it('should render TryToAsk when config enabled, suggestedQuestions present, and onSend provided', () => {
      renderChat({
        config: tryToAskConfig,
        suggestedQuestions: ['q1', 'q2'],
        onSend: vi.fn() as unknown as OnSend,
      })
      expect(screen.getByTestId('try-to-ask')).toBeInTheDocument()
    })

    it('should not render TryToAsk when suggested_questions_after_answer is disabled', () => {
      renderChat({
        config: { suggested_questions_after_answer: { enabled: false } } as unknown as ChatConfig,
        suggestedQuestions: ['q1'],
        onSend: vi.fn() as unknown as OnSend,
      })
      expect(screen.queryByTestId('try-to-ask')).not.toBeInTheDocument()
    })

    it('should not render TryToAsk when suggestedQuestions is an empty array', () => {
      renderChat({
        config: tryToAskConfig,
        suggestedQuestions: [],
        onSend: vi.fn() as unknown as OnSend,
      })
      expect(screen.queryByTestId('try-to-ask')).not.toBeInTheDocument()
    })

    it('should not render TryToAsk when suggestedQuestions is undefined', () => {
      renderChat({
        config: tryToAskConfig,
        suggestedQuestions: undefined,
        onSend: vi.fn() as unknown as OnSend,
      })
      expect(screen.queryByTestId('try-to-ask')).not.toBeInTheDocument()
    })

    it('should not render TryToAsk when onSend is undefined', () => {
      renderChat({
        config: tryToAskConfig,
        suggestedQuestions: ['q1'],
        onSend: undefined,
      })
      expect(screen.queryByTestId('try-to-ask')).not.toBeInTheDocument()
    })
  })

  describe('ChatInputArea', () => {
    it('should render ChatInputArea by default when noChatInput is falsy', () => {
      renderChat({ noChatInput: false })
      expect(screen.getByTestId('chat-input-area')).toBeInTheDocument()
    })

    it('should not render ChatInputArea when noChatInput=true', () => {
      renderChat({ noChatInput: true })
      expect(screen.queryByTestId('chat-input-area')).not.toBeInTheDocument()
    })

    it('should pass disabled=true to ChatInputArea when inputDisabled=true', () => {
      renderChat({ inputDisabled: true })
      expect(screen.getByTestId('chat-input-area')).toHaveAttribute('data-disabled', 'true')
    })

    it('should pass disabled=false to ChatInputArea when inputDisabled is falsy', () => {
      renderChat({ inputDisabled: false })
      expect(screen.getByTestId('chat-input-area')).toHaveAttribute('data-disabled', 'false')
    })
  })

  describe('PromptLogModal', () => {
    it('should render PromptLogModal when showPromptLogModal=true and hideLogModal is falsy', () => {
      useAppStore.setState({ ...defaultStoreState, showPromptLogModal: true })
      renderChat({ hideLogModal: false })
      expect(screen.getByTestId('prompt-log-modal')).toBeInTheDocument()
    })

    it('should not render PromptLogModal when showPromptLogModal=false', () => {
      useAppStore.setState({ ...defaultStoreState, showPromptLogModal: false })
      renderChat()
      expect(screen.queryByTestId('prompt-log-modal')).not.toBeInTheDocument()
    })

    it('should not render PromptLogModal when hideLogModal=true even if showPromptLogModal=true', () => {
      useAppStore.setState({ ...defaultStoreState, showPromptLogModal: true })
      renderChat({ hideLogModal: true })
      expect(screen.queryByTestId('prompt-log-modal')).not.toBeInTheDocument()
    })

    it('should call setCurrentLogItem and setShowPromptLogModal(false) when cancel is clicked', async () => {
      const user = userEvent.setup()
      useAppStore.setState({ ...defaultStoreState, showPromptLogModal: true })
      renderChat({ hideLogModal: false })

      await user.click(screen.getByTestId('prompt-log-cancel'))

      expect(mockSetCurrentLogItem).toHaveBeenCalledTimes(1)
      expect(mockSetShowPromptLogModal).toHaveBeenCalledWith(false)
    })
  })

  describe('AgentLogModal', () => {
    it('should render AgentLogModal when showAgentLogModal=true and hideLogModal is falsy', () => {
      useAppStore.setState({ ...defaultStoreState, showAgentLogModal: true })
      renderChat({ hideLogModal: false })
      expect(screen.getByTestId('agent-log-modal')).toBeInTheDocument()
    })

    it('should not render AgentLogModal when showAgentLogModal=false', () => {
      useAppStore.setState({ ...defaultStoreState, showAgentLogModal: false })
      renderChat()
      expect(screen.queryByTestId('agent-log-modal')).not.toBeInTheDocument()
    })

    it('should not render AgentLogModal when hideLogModal=true even if showAgentLogModal=true', () => {
      useAppStore.setState({ ...defaultStoreState, showAgentLogModal: true })
      renderChat({ hideLogModal: true })
      expect(screen.queryByTestId('agent-log-modal')).not.toBeInTheDocument()
    })

    it('should call setCurrentLogItem and setShowAgentLogModal(false) when cancel is clicked', async () => {
      const user = userEvent.setup()
      useAppStore.setState({ ...defaultStoreState, showAgentLogModal: true })
      renderChat({ hideLogModal: false })

      await user.click(screen.getByTestId('agent-log-cancel'))

      expect(mockSetCurrentLogItem).toHaveBeenCalledTimes(1)
      expect(mockSetShowAgentLogModal).toHaveBeenCalledWith(false)
    })
  })

  describe('Window Resize', () => {
    it('should add a resize event listener on mount', () => {
      const addSpy = vi.spyOn(window, 'addEventListener')
      renderChat()
      expect(addSpy).toHaveBeenCalledWith('resize', expect.any(Function))
    })

    it('should remove the resize event listener on unmount', () => {
      const removeSpy = vi.spyOn(window, 'removeEventListener')
      const { unmount } = renderChat()
      unmount()
      expect(removeSpy).toHaveBeenCalledWith('resize', expect.any(Function))
    })

    it('should call resize handler when window resize event fires', () => {
      renderChat()
      expect(() => window.dispatchEvent(new Event('resize'))).not.toThrow()
    })
  })

  describe('ResizeObserver Callbacks', () => {
    it('should set paddingBottom on chatContainer when footer size changes', () => {
      renderChat({
        chatList: [
          makeChatItem({ id: 'q1', isAnswer: false }),
          makeChatItem({ id: 'a1', isAnswer: true }),
        ],
      })

      const containerObserverCallback = capturedResizeCallbacks[0]
      if (containerObserverCallback) {
        act(() => {
          containerObserverCallback(
            [makeResizeEntry(80, 400)],
            {} as ResizeObserver,
          )
        })
        expect(screen.getByTestId('chat-container').style.paddingBottom).toBe('80px')
      }
    })

    it('should set footer width when container size changes', () => {
      renderChat()

      const footerObserverCallback = capturedResizeCallbacks[1]
      if (footerObserverCallback) {
        act(() => {
          footerObserverCallback(
            [makeResizeEntry(50, 600)],
            {} as ResizeObserver,
          )
        })
        expect(screen.getByTestId('chat-footer').style.width).toBe('600px')
      }
    })

    it('should disconnect observers on unmount', () => {
      const disconnectSpy = vi.fn()
      vi.stubGlobal('ResizeObserver', class {
        observe() { }
        unobserve() { }
        disconnect = disconnectSpy
      })

      const { unmount } = renderChat()
      unmount()

      expect(disconnectSpy).toHaveBeenCalled()
    })
  })

  describe('User Scrolling and Auto-scroll behavior', () => {
    it('should detect manual scroll up and prevent auto-scroll on new message', () => {
      const { rerender } = renderChat({
        chatList: [
          makeChatItem({ id: 'msg-1' }),
          makeChatItem({ id: 'msg-2' }),
        ],
      })

      const container = screen.getByTestId('chat-container')

      Object.defineProperties(container, {
        scrollHeight: { value: 1000, configurable: true },
        clientHeight: { value: 200, configurable: true },
        scrollTop: { value: 100, writable: true, configurable: true },
      })

      act(() => {
        container.dispatchEvent(new Event('scroll'))
      })

      const scrollTopSetter = vi.fn()
      Object.defineProperty(container, 'scrollTop', {
        get: () => 100,
        set: scrollTopSetter,
        configurable: true,
      })

      rerender(
        <Chat chatList={[
          makeChatItem({ id: 'msg-1' }),
          makeChatItem({ id: 'msg-2' }),
          makeChatItem({ id: 'msg-3' }),
        ]}
        />,
      )

      expect(scrollTopSetter).not.toHaveBeenCalled()
    })

    it('should auto-scroll if user is already at the bottom', () => {
      const { rerender } = renderChat({
        chatList: [
          makeChatItem({ id: 'msg-1' }),
          makeChatItem({ id: 'msg-2' }),
        ],
      })

      const container = screen.getByTestId('chat-container')

      Object.defineProperties(container, {
        scrollHeight: { value: 1000, configurable: true },
        clientHeight: { value: 200, configurable: true },
        scrollTop: { value: 800, writable: true, configurable: true },
      })

      act(() => {
        container.dispatchEvent(new Event('scroll'))
      })

      const scrollTopSetter = vi.fn()
      Object.defineProperty(container, 'scrollTop', {
        get: () => 800,
        set: scrollTopSetter,
        configurable: true,
      })

      rerender(
        <Chat chatList={[
          makeChatItem({ id: 'msg-1' }),
          makeChatItem({ id: 'msg-2' }),
          makeChatItem({ id: 'msg-3' }),
        ]}
        />,
      )

      expect(scrollTopSetter).toHaveBeenCalledWith(1000)
    })

    it('should ignore scroll events immediately after programmatic auto-scrolling', () => {
      const { rerender } = renderChat({
        chatList: [
          makeChatItem({ id: 'msg-1' }),
          makeChatItem({ id: 'msg-2' }),
        ],
      })

      const container = screen.getByTestId('chat-container')

      // Fix: Explicitly type the variable
      let rAFCallback: FrameRequestCallback | undefined

      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
        rAFCallback = cb
        return 1
      })

      rerender(
        <Chat chatList={[
          makeChatItem({ id: 'msg-1' }),
          makeChatItem({ id: 'msg-2' }),
          makeChatItem({ id: 'msg-3' }),
        ]}
        />,
      )

      Object.defineProperties(container, {
        scrollHeight: { value: 1000, configurable: true },
        clientHeight: { value: 200, configurable: true },
        scrollTop: { value: 100, writable: true, configurable: true },
      })

      act(() => {
        container.dispatchEvent(new Event('scroll'))
      })

      // Fix: Check if it's a function before calling to satisfy TS
      if (typeof rAFCallback === 'function')
        rAFCallback(0)

      const scrollTopSetter = vi.fn()
      Object.defineProperty(container, 'scrollTop', {
        get: () => 100,
        set: scrollTopSetter,
        configurable: true,
      })

      rerender(
        <Chat chatList={[
          makeChatItem({ id: 'msg-1' }),
          makeChatItem({ id: 'msg-2' }),
          makeChatItem({ id: 'msg-3' }),
          makeChatItem({ id: 'msg-4' }),
        ]}
        />,
      )

      expect(scrollTopSetter).toHaveBeenCalled()
    })
  })

  describe('Sidebar Collapse State', () => {
    it('should trigger handleWindowResize via setTimeout when sidebarCollapseState becomes false', () => {
      vi.useFakeTimers()
      const { rerender } = renderChat({ sidebarCollapseState: true })

      rerender(<Chat chatList={[]} sidebarCollapseState={false} />)
      vi.runAllTimers()

      expect(screen.getByTestId('chat-root')).toBeInTheDocument()
      vi.useRealTimers()
    })

    it('should not trigger resize when sidebarCollapseState is true', () => {
      vi.useFakeTimers()
      renderChat({ sidebarCollapseState: true })
      expect(() => vi.runAllTimers()).not.toThrow()
      vi.useRealTimers()
    })
  })

  describe('Edge Cases', () => {
    it('should render without crashing when no optional props are provided', () => {
      expect(() => render(<Chat chatList={[]} />)).not.toThrow()
    })

    it('should render both Answer and Question for a long chatList', () => {
      const chatList = Array.from({ length: 6 }, (_, i) =>
        makeChatItem({ id: `item-${i}`, isAnswer: i % 2 === 1 }))
      renderChat({ chatList })
      expect(screen.getAllByTestId('question-item')).toHaveLength(3)
      expect(screen.getAllByTestId('answer-item')).toHaveLength(3)
    })

    it('should handle readonly=true without crashing', () => {
      expect(() => renderChat({ readonly: true })).not.toThrow()
    })

    it('should handle all modal states off simultaneously', () => {
      useAppStore.setState({ ...defaultStoreState, showPromptLogModal: false, showAgentLogModal: false })
      renderChat()
      expect(screen.queryByTestId('prompt-log-modal')).not.toBeInTheDocument()
      expect(screen.queryByTestId('agent-log-modal')).not.toBeInTheDocument()
    })
  })
})
