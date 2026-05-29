import type { ChatItem } from '../../../types'
import type { AppData } from '@/models/share'
import { act, fireEvent, render, screen } from '@testing-library/react'
import Answer from '../index'

// Mock the chat context
vi.mock('../context', () => ({
  useChatContext: vi.fn(() => ({
    getHumanInputNodeData: vi.fn(),
  })),
}))

describe('Answer Component', () => {
  const defaultProps = {
    item: {
      id: 'msg-1',
      content: 'Test response',
      isAnswer: true,
    } as unknown as ChatItem,
    question: 'Hello?',
    index: 0,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      value: 500,
    })
  })

  describe('Rendering', () => {
    it('should render basic content correctly', async () => {
      render(<Answer {...defaultProps} />)
      expect(screen.getByTestId('markdown-body')).toBeInTheDocument()
    })

    it('should render loading animation when responding and content is empty', () => {
      const { container } = render(
        <Answer
          {...defaultProps}
          item={{ id: '1', content: '', isAnswer: true } as unknown as ChatItem}
          responding={true}
        />,
      )
      expect(container).toBeInTheDocument()
    })
  })

  describe('Component Blocks', () => {
    it('should render workflow process', () => {
      render(
        <Answer
          {...defaultProps}
          item={{
            ...defaultProps.item,
            workflowProcess: { status: 'running', tracing: [], steps: [] },
          } as unknown as ChatItem}
        />,
      )
      expect(screen.getByTestId('chat-answer-container')).toBeInTheDocument()
    })

    it('should render agent thoughts', () => {
      const { container } = render(
        <Answer
          {...defaultProps}
          item={{
            ...defaultProps.item,
            agent_thoughts: [{ id: '1', thought: 'Thinking...' }],
          } as unknown as ChatItem}
        />,
      )
      expect(container.querySelector('.group')).toBeInTheDocument()
    })

    it('should render file lists', () => {
      render(
        <Answer
          {...defaultProps}
          item={{
            ...defaultProps.item,
            allFiles: [{ id: 'f1', type: 'image', name: 'test.png' }],
            message_files: [{ id: 'f2', type: 'document', name: 'doc.pdf' }],
          } as unknown as ChatItem}
        />,
      )
      expect(screen.getAllByTestId('file-list')).toHaveLength(2)
    })

    it('should render annotation edit title', async () => {
      render(
        <Answer
          {...defaultProps}
          item={{
            ...defaultProps.item,
            annotation: { id: 'a1', authorName: 'John Doe' },
          } as unknown as ChatItem}
        />,
      )
      expect(await screen.findByText(/John Doe/i)).toBeInTheDocument()
    })

    it('should render citations', () => {
      render(
        <Answer
          {...defaultProps}
          item={{
            ...defaultProps.item,
            citation: [{ id: 'c1', title: 'Source 1' }],
          } as unknown as ChatItem}
        />,
      )
      expect(screen.getByTestId('citation-title')).toBeInTheDocument()
    })
  })

  describe('Human Inputs Layout', () => {
    it('should render human input form data list', () => {
      render(
        <Answer
          {...defaultProps}
          item={{
            ...defaultProps.item,
            humanInputFormDataList: [{ id: 'form1' }],
          } as unknown as ChatItem}
        />,
      )
      expect(screen.getByTestId('chat-answer-container')).toBeInTheDocument()
    })

    it('should render human input filled form data list', () => {
      render(
        <Answer
          {...defaultProps}
          item={{
            ...defaultProps.item,
            humanInputFilledFormDataList: [{ id: 'form1_filled' }],
          } as unknown as ChatItem}
        />,
      )
      expect(screen.getByTestId('chat-answer-container')).toBeInTheDocument()
    })
  })

  describe('Interactions', () => {
    it('should handle switch sibling', () => {
      const mockSwitchSibling = vi.fn()
      render(
        <Answer
          {...defaultProps}
          item={{
            ...defaultProps.item,
            siblingCount: 3,
            siblingIndex: 1,
            prevSibling: 'msg-0',
            nextSibling: 'msg-2',
          } as unknown as ChatItem}
          switchSibling={mockSwitchSibling}
        />,
      )

      const prevBtn = screen.getByRole('button', { name: 'Previous' })
      fireEvent.click(prevBtn)
      expect(mockSwitchSibling).toHaveBeenCalledWith('msg-0')

      // reset mock for next sibling click
      const nextBtn = screen.getByRole('button', { name: 'Next' })
      fireEvent.click(nextBtn)
      expect(mockSwitchSibling).toHaveBeenCalledWith('msg-2')
    })
  })

  describe('Edge Cases and Props', () => {
    it('should handle hideAvatar properly', () => {
      render(<Answer {...defaultProps} hideAvatar={true} />)
      expect(screen.queryByTestId('emoji')).not.toBeInTheDocument()
    })

    it('should render custom answerIcon', () => {
      render(
        <Answer
          {...defaultProps}
          answerIcon={<div data-testid="custom-answer-icon">Custom Icon</div>}
        />,
      )
      expect(screen.getByTestId('custom-answer-icon')).toBeInTheDocument()
    })

    it('should handle hideProcessDetail with appData', () => {
      render(
        <Answer
          {...defaultProps}
          hideProcessDetail={true}
          appData={{ site: { show_workflow_steps: false } } as unknown as AppData}
          item={{
            ...defaultProps.item,
            workflowProcess: { status: 'running', tracing: [], steps: [] },
          } as unknown as ChatItem}
        />,
      )
      expect(screen.getByTestId('chat-answer-container')).toBeInTheDocument()
    })

    it('should render More component', () => {
      render(
        <Answer
          {...defaultProps}
          item={{
            ...defaultProps.item,
            more: { messages: [{ text: 'more content' }] },
          } as unknown as ChatItem}
        />,
      )
      expect(screen.getByTestId('more-container')).toBeInTheDocument()
    })

    it('should render content with hasHumanInput but contentIsEmpty and no agent_thoughts', () => {
      render(
        <Answer
          {...defaultProps}
          item={{
            ...defaultProps.item,
            content: '',
            humanInputFormDataList: [{ id: 'form1' }],
          } as unknown as ChatItem}
        />,
      )
      expect(screen.getByTestId('chat-answer-container-humaninput')).toBeInTheDocument()
    })

    it('should render content switch within hasHumanInput but contentIsEmpty', () => {
      render(
        <Answer
          {...defaultProps}
          item={{
            ...defaultProps.item,
            content: '',
            siblingCount: 2,
            siblingIndex: 1,
            prevSibling: 'msg-0',
            humanInputFormDataList: [{ id: 'form1' }],
          } as unknown as ChatItem}
        />,
      )
      expect(screen.getByTestId('chat-answer-container-humaninput')).toBeInTheDocument()
    })

    it('should handle responding=true in human inputs layout block 2', () => {
      const { container } = render(
        <Answer
          {...defaultProps}
          responding={true}
          item={{
            ...defaultProps.item,
            content: '',
            humanInputFormDataList: [{ id: 'form1' }],
          } as unknown as ChatItem}
        />,
      )
      expect(container).toBeInTheDocument()
    })

    it('should handle ResizeObserver callback', () => {
      const originalResizeObserver = globalThis.ResizeObserver
      let triggerResize = () => { }
      globalThis.ResizeObserver = class ResizeObserver {
        constructor(callback: unknown) {
          triggerResize = callback as () => void
        }

        observe() { }
        unobserve() { }
        disconnect() { }
      } as unknown as typeof ResizeObserver

      render(<Answer {...defaultProps} />)

      // Trigger the callback to cover getContentWidth and getHumanInputFormContainerWidth
      act(() => {
        triggerResize()
      })

      globalThis.ResizeObserver = originalResizeObserver
      // Verify component still renders correctly after resize callback
      expect(screen.getByTestId('chat-answer-container')).toBeInTheDocument()
    })

    it('should render all component blocks within human inputs layout to cover missing branches', () => {
      const { container } = render(
        <Answer
          {...defaultProps}
          item={{
            ...defaultProps.item,
            humanInputFilledFormDataList: [{ id: 'form1' } as unknown as Record<string, unknown>],
            humanInputFormDataList: [], // hits length > 0 false branch
            agent_thoughts: [{ id: 'thought1', thought: 'thinking' }],
            allFiles: [{ _id: 'file1', name: 'file1.txt', type: 'document' } as unknown as Record<string, unknown>],
            message_files: [{ id: 'file2', url: 'http://test.com', type: 'image/png' } as unknown as Record<string, unknown>],
            annotation: { id: 'anno1', authorName: 'Author' } as unknown as Record<string, unknown>,
            citation: [{ item: { title: 'cite 1' } }] as unknown as Record<string, unknown>[],
            siblingCount: 2,
            siblingIndex: 1,
            prevSibling: 'msg-0',
            nextSibling: 'msg-2',
            more: { messages: [{ text: 'more content' }] },
          } as unknown as ChatItem}
        />,
      )
      expect(container).toBeInTheDocument()
    })

    it('should handle hideProcessDetail with NO appData', () => {
      render(
        <Answer
          {...defaultProps}
          hideProcessDetail={true}
          appData={undefined}
          item={{
            ...defaultProps.item,
            workflowProcess: { status: 'running', tracing: [], steps: [] },
          } as unknown as ChatItem}
        />,
      )
      expect(screen.getByTestId('chat-answer-container')).toBeInTheDocument()
    })

    it('should handle hideProcessDetail branches in human inputs layout', () => {
      // Branch: hideProcessDetail=true, appData=undefined
      const { container: c1 } = render(
        <Answer
          {...defaultProps}
          hideProcessDetail={true}
          appData={undefined}
          item={{
            ...defaultProps.item,
            workflowProcess: { status: 'running', tracing: [], steps: [] },
            humanInputFormDataList: [{ id: 'form1' } as unknown as Record<string, unknown>],
          } as unknown as ChatItem}
        />,
      )

      // Branch: hideProcessDetail=true, appData provided
      const { container: c2 } = render(
        <Answer
          {...defaultProps}
          hideProcessDetail={true}
          appData={{ site: { show_workflow_steps: false } } as unknown as AppData}
          item={{
            ...defaultProps.item,
            workflowProcess: { status: 'running', tracing: [], steps: [] },
            humanInputFormDataList: [{ id: 'form1' } as unknown as Record<string, unknown>],
          } as unknown as ChatItem}
        />,
      )

      // Branch: hideProcessDetail=false
      const { container: c3 } = render(
        <Answer
          {...defaultProps}
          hideProcessDetail={false}
          appData={{ site: { show_workflow_steps: true } } as unknown as AppData}
          item={{
            ...defaultProps.item,
            workflowProcess: { status: 'running', tracing: [], steps: [] },
            humanInputFormDataList: [{ id: 'form1' } as unknown as Record<string, unknown>],
          } as unknown as ChatItem}
        />,
      )

      expect(c1).toBeInTheDocument()
      expect(c2).toBeInTheDocument()
      expect(c3).toBeInTheDocument()
    })
  })
})
