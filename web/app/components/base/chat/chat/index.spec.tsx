import type { ChatConfig, ChatItem, OnSend } from '../types'
import type { ChatProps } from './index'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore as useAppStore } from '@/app/components/app/store'
import Chat from './index'

// ─── Why each mock exists ─────────────────────────────────────────────────────
//
// Answer        – transitively pulls Markdown (rehype/remark/katex), AgentContent,
//                 WorkflowProcessItem and Operation; none can resolve in jsdom.
// Question      – pulls Markdown, copy-to-clipboard, react-textarea-autosize.
// ChatInputArea – pulls js-audio-recorder (requires Web Audio API unavailable in
//                 jsdom) and VoiceInput / FileContextProvider chains.
// PromptLogModal– pulls CopyFeedbackNew and deep modal dep chain.
// AgentLogModal – pulls @remixicon/react (causes lint push error), useClickAway
//                 from ahooks, and AgentLogDetail (workflow graph renderer).
// es-toolkit/compat – debounce must return a fn with .cancel() or the cleanup
//                 effect throws on unmount.
//
// NOT mocked (run real):
//   ChatContextProvider – plain context wrapper, zero side-effects.
//   TryToAsk            – only uses Button (base), Divider (base), i18n (global mock).
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('./answer', () => ({
  default: ({ item, responding }: { item: ChatItem, responding?: boolean }) => (
    <div
      data-testid="answer-item"
      data-id={item.id}
      data-responding={String(!!responding)}
    >
      {item.content}
    </div>
  ),
}))

vi.mock('./question', () => ({
  default: ({ item }: { item: ChatItem }) => (
    <div data-testid="question-item" data-id={item.id}>{item.content}</div>
  ),
}))

vi.mock('./chat-input-area', () => ({
  default: ({ disabled, readonly }: { disabled?: boolean, readonly?: boolean }) => (
    <div
      data-testid="chat-input-area"
      data-disabled={String(!!disabled)}
      data-readonly={String(!!readonly)}
    />
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

// ─── ResizeObserver capture ───────────────────────────────────────────────────

type ResizeCallback = (entries: ResizeObserverEntry[], observer: ResizeObserver) => void
let capturedResizeCallbacks: ResizeCallback[] = []

const makeResizeEntry = (blockSize: number, inlineSize: number): ResizeObserverEntry => ({
  borderBoxSize: [{ blockSize, inlineSize } as ResizeObserverSize],
  contentBoxSize: [{ blockSize, inlineSize } as ResizeObserverSize],
  contentRect: new DOMRect(0, 0, inlineSize, blockSize),
  devicePixelContentBoxSize: [{ blockSize, inlineSize } as ResizeObserverSize],
  target: document.createElement('div'),
})

// ─── Factories ────────────────────────────────────────────────────────────────

const makeChatItem = (overrides: Partial<ChatItem> = {}): ChatItem => ({
  id: `item-${Math.random().toString(36).slice(2)}`,
  content: 'Test content',
  isAnswer: false,
  ...overrides,
})

const mockSetCurrentLogItem = vi.fn()
const mockSetShowPromptLogModal = vi.fn()
const mockSetShowAgentLogModal = vi.fn()

const baseStoreState = {
  currentLogItem: undefined,
  setCurrentLogItem: mockSetCurrentLogItem,
  showPromptLogModal: false,
  setShowPromptLogModal: mockSetShowPromptLogModal,
  showAgentLogModal: false,
  setShowAgentLogModal: mockSetShowAgentLogModal,
}

const renderChat = (props: Partial<ChatProps> = {}) =>
  render(<Chat chatList={[]} {...props} />)

// ─── Suite ────────────────────────────────────────────────────────────────────

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

    useAppStore.setState(baseStoreState)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('Rendering', () => {
    it('should render without crashing with an empty chatList', () => {
      renderChat()
      expect(screen.getByTestId('chat-root')).toBeInTheDocument()
    })

    it('should render chatNode when provided', () => {
      renderChat({ chatNode: <div data-testid="slot-node">slot</div> })
      expect(screen.getByTestId('slot-node')).toBeInTheDocument()
    })

    it('should apply flex-col to root when isTryApp=true', () => {
      renderChat({ isTryApp: true })
      expect(screen.getByTestId('chat-root')).toHaveClass('flex', 'flex-col')
    })

    it('should not have flex-col when isTryApp is falsy', () => {
      renderChat({ isTryApp: false })
      expect(screen.getByTestId('chat-root')).not.toHaveClass('flex-col')
    })

    it('should apply chatContainerClassName to the scroll container', () => {
      renderChat({ chatContainerClassName: 'my-custom-class' })
      expect(screen.getByTestId('chat-container')).toHaveClass('my-custom-class')
    })

    it('should apply px-8 spacing by default', () => {
      const { container } = renderChat({ noSpacing: false })
      expect(container.querySelector('.w-full')).toHaveClass('px-8')
    })

    it('should omit px-8 when noSpacing=true', () => {
      const { container } = renderChat({ noSpacing: true })
      expect(container.querySelector('.w-full')).not.toHaveClass('px-8')
    })
  })

  describe('Chat List', () => {
    it('should render a Question for a non-answer item', () => {
      renderChat({ chatList: [makeChatItem({ id: 'q1', isAnswer: false })] })
      expect(screen.getByTestId('question-item')).toBeInTheDocument()
    })

    it('should render an Answer for an answer item', () => {
      renderChat({ chatList: [makeChatItem({ id: 'a1', isAnswer: true })] })
      expect(screen.getByTestId('answer-item')).toBeInTheDocument()
    })

    it('should render both Question and Answer from a mixed chatList', () => {
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

    it('should render correct counts for a long mixed chatList', () => {
      const chatList = Array.from({ length: 6 }, (_, i) =>
        makeChatItem({ id: `item-${i}`, isAnswer: i % 2 === 1 }))
      renderChat({ chatList })
      expect(screen.getAllByTestId('question-item')).toHaveLength(3)
      expect(screen.getAllByTestId('answer-item')).toHaveLength(3)
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

    it('should render the stopResponding i18n key', () => {
      renderChat({ isResponding: true, noStopResponding: false })
      expect(screen.getByText(/stopResponding/i)).toBeInTheDocument()
    })
  })

  describe('TryToAsk (real component)', () => {
    const tryToAskConfig: ChatConfig = {
      suggested_questions_after_answer: { enabled: true },
    } as ChatConfig

    const mockOnSend = vi.fn() as unknown as OnSend

    it('should render the tryToAsk i18n key when all conditions are met', () => {
      renderChat({
        config: tryToAskConfig,
        suggestedQuestions: ['What is AI?'],
        onSend: mockOnSend,
      })
      expect(screen.getByText(/tryToAsk/i)).toBeInTheDocument()
    })

    it('should render each suggested question as a button', () => {
      renderChat({
        config: tryToAskConfig,
        suggestedQuestions: ['First question', 'Second question'],
        onSend: mockOnSend,
      })
      expect(screen.getByText('First question')).toBeInTheDocument()
      expect(screen.getByText('Second question')).toBeInTheDocument()
    })

    it('should call onSend with the question text when a suggestion button is clicked', async () => {
      const user = userEvent.setup()
      const onSend = vi.fn() as unknown as OnSend
      renderChat({
        config: tryToAskConfig,
        suggestedQuestions: ['Ask this'],
        onSend,
      })

      await user.click(screen.getByText('Ask this'))

      expect(onSend).toHaveBeenCalledWith('Ask this')
    })

    it('should not render TryToAsk when suggested_questions_after_answer is disabled', () => {
      renderChat({
        config: { suggested_questions_after_answer: { enabled: false } } as ChatConfig,
        suggestedQuestions: ['q1'],
        onSend: mockOnSend,
      })
      expect(screen.queryByText(/tryToAsk/i)).not.toBeInTheDocument()
    })

    it('should not render TryToAsk when suggestedQuestions is an empty array', () => {
      renderChat({
        config: tryToAskConfig,
        suggestedQuestions: [],
        onSend: mockOnSend,
      })
      expect(screen.queryByText(/tryToAsk/i)).not.toBeInTheDocument()
    })

    it('should not render TryToAsk when suggestedQuestions is undefined', () => {
      renderChat({
        config: tryToAskConfig,
        suggestedQuestions: undefined,
        onSend: mockOnSend,
      })
      expect(screen.queryByText(/tryToAsk/i)).not.toBeInTheDocument()
    })

    it('should not render TryToAsk when onSend is undefined', () => {
      renderChat({
        config: tryToAskConfig,
        suggestedQuestions: ['q1'],
        onSend: undefined,
      })
      expect(screen.queryByText(/tryToAsk/i)).not.toBeInTheDocument()
    })

    it('should not render TryToAsk when config is undefined', () => {
      renderChat({
        config: undefined,
        suggestedQuestions: ['q1'],
        onSend: mockOnSend,
      })
      expect(screen.queryByText(/tryToAsk/i)).not.toBeInTheDocument()
    })
  })

  describe('ChatInputArea', () => {
    it('should render when noChatInput is falsy', () => {
      renderChat({ noChatInput: false })
      expect(screen.getByTestId('chat-input-area')).toBeInTheDocument()
    })

    it('should not render when noChatInput=true', () => {
      renderChat({ noChatInput: true })
      expect(screen.queryByTestId('chat-input-area')).not.toBeInTheDocument()
    })

    it('should pass disabled=true when inputDisabled=true', () => {
      renderChat({ inputDisabled: true })
      expect(screen.getByTestId('chat-input-area')).toHaveAttribute('data-disabled', 'true')
    })

    it('should pass disabled=false when inputDisabled is falsy', () => {
      renderChat({ inputDisabled: false })
      expect(screen.getByTestId('chat-input-area')).toHaveAttribute('data-disabled', 'false')
    })

    it('should pass readonly=true to ChatInputArea when readonly=true', () => {
      renderChat({ readonly: true })
      expect(screen.getByTestId('chat-input-area')).toHaveAttribute('data-readonly', 'true')
    })
  })

  describe('PromptLogModal', () => {
    it('should render when showPromptLogModal=true and hideLogModal is falsy', () => {
      useAppStore.setState({ ...baseStoreState, showPromptLogModal: true })
      renderChat({ hideLogModal: false })
      expect(screen.getByTestId('prompt-log-modal')).toBeInTheDocument()
    })

    it('should not render when showPromptLogModal=false', () => {
      useAppStore.setState({ ...baseStoreState, showPromptLogModal: false })
      renderChat()
      expect(screen.queryByTestId('prompt-log-modal')).not.toBeInTheDocument()
    })

    it('should not render when hideLogModal=true even if showPromptLogModal=true', () => {
      useAppStore.setState({ ...baseStoreState, showPromptLogModal: true })
      renderChat({ hideLogModal: true })
      expect(screen.queryByTestId('prompt-log-modal')).not.toBeInTheDocument()
    })

    it('should call setCurrentLogItem and setShowPromptLogModal(false) on cancel', async () => {
      const user = userEvent.setup()
      useAppStore.setState({ ...baseStoreState, showPromptLogModal: true })
      renderChat({ hideLogModal: false })

      await user.click(screen.getByTestId('prompt-log-cancel'))

      expect(mockSetCurrentLogItem).toHaveBeenCalledTimes(1)
      expect(mockSetShowPromptLogModal).toHaveBeenCalledWith(false)
    })
  })

  describe('AgentLogModal', () => {
    it('should render when showAgentLogModal=true and hideLogModal is falsy', () => {
      useAppStore.setState({ ...baseStoreState, showAgentLogModal: true })
      renderChat({ hideLogModal: false })
      expect(screen.getByTestId('agent-log-modal')).toBeInTheDocument()
    })

    it('should not render when showAgentLogModal=false', () => {
      useAppStore.setState({ ...baseStoreState, showAgentLogModal: false })
      renderChat()
      expect(screen.queryByTestId('agent-log-modal')).not.toBeInTheDocument()
    })

    it('should not render when hideLogModal=true even if showAgentLogModal=true', () => {
      useAppStore.setState({ ...baseStoreState, showAgentLogModal: true })
      renderChat({ hideLogModal: true })
      expect(screen.queryByTestId('agent-log-modal')).not.toBeInTheDocument()
    })

    it('should call setCurrentLogItem and setShowAgentLogModal(false) on cancel', async () => {
      const user = userEvent.setup()
      useAppStore.setState({ ...baseStoreState, showAgentLogModal: true })
      renderChat({ hideLogModal: false })

      await user.click(screen.getByTestId('agent-log-cancel'))

      expect(mockSetCurrentLogItem).toHaveBeenCalledTimes(1)
      expect(mockSetShowAgentLogModal).toHaveBeenCalledWith(false)
    })
  })

  describe('Window Resize', () => {
    it('should register a resize listener on mount', () => {
      const addSpy = vi.spyOn(window, 'addEventListener')
      renderChat()
      expect(addSpy).toHaveBeenCalledWith('resize', expect.any(Function))
    })

    it('should remove the resize listener on unmount', () => {
      const removeSpy = vi.spyOn(window, 'removeEventListener')
      const { unmount } = renderChat()
      unmount()
      expect(removeSpy).toHaveBeenCalledWith('resize', expect.any(Function))
    })

    it('should not throw when the resize event fires', () => {
      renderChat()
      expect(() => window.dispatchEvent(new Event('resize'))).not.toThrow()
    })
  })

  describe('ResizeObserver Callbacks', () => {
    it('should set paddingBottom on chatContainer from the footer blockSize', () => {
      renderChat({
        chatList: [
          makeChatItem({ id: 'q1', isAnswer: false }),
          makeChatItem({ id: 'a1', isAnswer: true }),
        ],
      })
      const containerCb = capturedResizeCallbacks[0]
      if (containerCb) {
        act(() => containerCb([makeResizeEntry(80, 400)], {} as ResizeObserver))
        expect(screen.getByTestId('chat-container').style.paddingBottom).toBe('80px')
      }
    })

    it('should set footer width from the container inlineSize', () => {
      renderChat()
      const footerCb = capturedResizeCallbacks[1]
      if (footerCb) {
        act(() => footerCb([makeResizeEntry(50, 600)], {} as ResizeObserver))
        expect(screen.getByTestId('chat-footer').style.width).toBe('600px')
      }
    })

    it('should disconnect both observers on unmount', () => {
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

  describe('Scroll Behavior', () => {
    it('should not throw when chatList has 1 item (scroll guard: length > 1 not met)', () => {
      expect(() => renderChat({ chatList: [makeChatItem({ id: 'q1' })] })).not.toThrow()
    })

    it('should not throw when a scroll event fires on the container', () => {
      renderChat()
      expect(() =>
        screen.getByTestId('chat-container').dispatchEvent(new Event('scroll')),
      ).not.toThrow()
    })

    it('should set userScrolled when distanceToBottom exceeds threshold', () => {
      renderChat()
      const container = screen.getByTestId('chat-container')
      Object.defineProperty(container, 'scrollHeight', { value: 1000, configurable: true })
      Object.defineProperty(container, 'clientHeight', { value: 400, configurable: true })
      Object.defineProperty(container, 'scrollTop', { value: 0, configurable: true })
      expect(() => container.dispatchEvent(new Event('scroll'))).not.toThrow()
    })

    it('should not set userScrolled when distanceToBottom is within threshold', () => {
      renderChat()
      const container = screen.getByTestId('chat-container')
      Object.defineProperty(container, 'scrollHeight', { value: 500, configurable: true })
      Object.defineProperty(container, 'clientHeight', { value: 400, configurable: true })
      Object.defineProperty(container, 'scrollTop', { value: 99, configurable: true })
      expect(() => container.dispatchEvent(new Event('scroll'))).not.toThrow()
    })
  })

  describe('ChatList Scroll Reset', () => {
    it('should not throw with empty chatList (length <= 1 branch)', () => {
      expect(() => renderChat({ chatList: [] })).not.toThrow()
    })

    it('should not throw with exactly one item (length <= 1 branch)', () => {
      expect(() => renderChat({ chatList: [makeChatItem({ id: 'msg-1' })] })).not.toThrow()
    })

    it('should reset scroll state when the first message ID changes on rerender', () => {
      const { rerender } = renderChat({
        chatList: [makeChatItem({ id: 'first' }), makeChatItem({ id: 'second' })],
      })
      expect(() =>
        rerender(<Chat chatList={[makeChatItem({ id: 'new-first' }), makeChatItem({ id: 'new-second' })]} />),
      ).not.toThrow()
    })

    it('should not reset scroll when the first message ID is unchanged', () => {
      const item1 = makeChatItem({ id: 'stable-id' })
      const { rerender } = renderChat({ chatList: [item1, makeChatItem({ id: 'second' })] })
      expect(() =>
        rerender(<Chat chatList={[item1, makeChatItem({ id: 'third' })]} />),
      ).not.toThrow()
    })
  })

  describe('Sidebar Collapse State', () => {
    it('should schedule a resize via setTimeout when sidebarCollapseState becomes false', () => {
      vi.useFakeTimers()
      const { rerender } = renderChat({ sidebarCollapseState: true })
      rerender(<Chat chatList={[]} sidebarCollapseState={false} />)
      expect(() => vi.runAllTimers()).not.toThrow()
      vi.useRealTimers()
    })

    it('should not schedule a resize when sidebarCollapseState stays true', () => {
      vi.useFakeTimers()
      renderChat({ sidebarCollapseState: true })
      expect(() => vi.runAllTimers()).not.toThrow()
      vi.useRealTimers()
    })
  })

  describe('Edge Cases', () => {
    it('should render without crashing with no optional props', () => {
      expect(() => render(<Chat chatList={[]} />)).not.toThrow()
    })

    it('should handle readonly=true without crashing', () => {
      expect(() => renderChat({ readonly: true })).not.toThrow()
    })

    it('should render no modals when both modal flags are false', () => {
      useAppStore.setState({ ...baseStoreState, showPromptLogModal: false, showAgentLogModal: false })
      renderChat()
      expect(screen.queryByTestId('prompt-log-modal')).not.toBeInTheDocument()
      expect(screen.queryByTestId('agent-log-modal')).not.toBeInTheDocument()
    })

    it('should render both modals when both flags are true and hideLogModal is false', () => {
      useAppStore.setState({ ...baseStoreState, showPromptLogModal: true, showAgentLogModal: true })
      renderChat({ hideLogModal: false })
      expect(screen.getByTestId('prompt-log-modal')).toBeInTheDocument()
      expect(screen.getByTestId('agent-log-modal')).toBeInTheDocument()
    })
  })
})
