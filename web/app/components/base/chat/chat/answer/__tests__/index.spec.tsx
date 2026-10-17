import type { ChatItem } from '../../../types'
import type { HumanInputFilledFormData, HumanInputFormData } from '@/types/workflow'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UserActionButtonType } from '@/app/components/workflow/nodes/human-input/types'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { TransferMethod } from '@/types/app'
import Answer from '../index'

const pendingForm: HumanInputFormData = {
  form_id: 'form-1',
  node_id: 'review',
  node_title: 'Review request',
  form_content: 'Please approve this response.',
  inputs: [],
  actions: [{ id: 'approve', title: 'Approve', button_style: UserActionButtonType.Primary }],
  form_token: 'form-token',
  resolved_default_values: {},
  display_in_ui: true,
  expiration_time: null,
}
const filledForm: HumanInputFilledFormData = {
  form_id: 'form-1',
  node_id: 'review',
  node_title: 'Completed review',
  rendered_content: 'Approved response',
  action_id: 'approve',
  action_text: 'Approved',
}

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

  describe('Rendering', () => {
    it('should render basic content correctly', async () => {
      render(<Answer {...defaultProps} />)
      expect(await screen.findByText('Test response')).toBeInTheDocument()
    })
  })

  describe('Component Blocks', () => {
    it('should render agent thoughts when no answer content has arrived', async () => {
      render(
        <Answer
          {...defaultProps}
          item={
            {
              ...defaultProps.item,
              content: '',
              agent_thoughts: [
                {
                  id: '1',
                  thought: 'Thinking...',
                  tool: '',
                  tool_input: '',
                  observation: '',
                  message_id: 'msg-1',
                  conversation_id: 'chat-1',
                  position: 1,
                },
              ],
            } as unknown as ChatItem
          }
        />,
      )
      expect(await screen.findByText('Thinking...')).toBeInTheDocument()
    })

    it('should render custom agent content when only agent response parts exist', () => {
      render(
        <Answer
          {...defaultProps}
          item={
            {
              id: 'msg-with-parts',
              content: '',
              isAnswer: true,
              agent_response_parts: [{ type: 'message', content: 'streamed answer' }],
            } as ChatItem
          }
          renderAgentContent={() => <div data-testid="custom-agent-content">streamed answer</div>}
        />,
      )

      expect(screen.getByTestId('custom-agent-content')).toHaveTextContent('streamed answer')
    })

    it('should render annotation edit title', async () => {
      render(
        <Answer
          {...defaultProps}
          item={
            {
              ...defaultProps.item,
              annotation: { id: 'a1', authorName: 'John Doe' },
            } as unknown as ChatItem
          }
        />,
      )
      expect(await screen.findByText(/John Doe/i)).toBeInTheDocument()
    })
  })

  // Reasoning panel slot (separated-mode chain-of-thought) in both layouts.
  // The panel body renders through the async dynamic Markdown, so assertions
  // target the synchronously-rendered "Thinking…/Thought" summary label.
  describe('Reasoning Panel', () => {
    it('should render the reasoning panel in the normal layout while thinking', () => {
      render(
        <Answer
          {...defaultProps}
          responding={true}
          item={
            {
              ...defaultProps.item,
              // Thinking ⇒ the answer has not started yet, so content must be empty.
              content: '',
              reasoningContent: { llm: 'deep thought' },
            } as unknown as ChatItem
          }
        />,
      )
      expect(screen.getByText(/chat\.thinking/)).toBeInTheDocument()
    })

    it('should render the reasoning panel in the thought state once finished', () => {
      render(
        <Answer
          {...defaultProps}
          item={
            {
              ...defaultProps.item,
              reasoningContent: { llm: 'recalled reasoning' },
              reasoningFinished: true,
            } as unknown as ChatItem
          }
        />,
      )
      expect(screen.getByText(/chat\.thought/)).toBeInTheDocument()
    })

    it('should render the reasoning panel within the human-input layout', () => {
      render(
        <Answer
          {...defaultProps}
          item={
            {
              ...defaultProps.item,
              reasoningContent: { llm: 'human-input reasoning' },
              humanInputFormDataList: [pendingForm],
            } as unknown as ChatItem
          }
        />,
      )
      // hasHumanInputs is true, so this can only come from the human-input slot
      expect(screen.getByText(/chat\.(thinking|thought)/)).toBeInTheDocument()
    })

    it('should render the reasoning panel in the human-input layout when the answer is empty (history reload)', () => {
      // Regression: the human-input slot outer guard must include hasReasoning, otherwise a
      // rehydrated message with forms + reasoning but an empty answer drops the panel entirely.
      render(
        <Answer
          {...defaultProps}
          item={
            {
              ...defaultProps.item,
              content: '',
              reasoningContent: { llm: 'reload reasoning' },
              reasoningFinished: true,
              humanInputFilledFormDataList: [filledForm],
            } as unknown as ChatItem
          }
        />,
      )
      expect(screen.getByText(/chat\.thought/)).toBeInTheDocument()
    })

    it('should not render the reasoning panel when reasoningContent is absent', () => {
      render(<Answer {...defaultProps} />)
      expect(screen.queryByText(/chat\.(thinking|thought)/)).not.toBeInTheDocument()
    })

    it('should not render the reasoning panel for an empty reasoningContent map (rehydrated, no reasoning)', () => {
      render(
        <Answer
          {...defaultProps}
          item={
            {
              ...defaultProps.item,
              reasoningContent: {},
            } as unknown as ChatItem
          }
        />,
      )
      expect(screen.queryByText(/chat\.(thinking|thought)/)).not.toBeInTheDocument()
    })
  })

  describe('Interactions', () => {
    it('should handle switch sibling', async () => {
      const mockSwitchSibling = vi.fn()
      render(
        <Answer
          {...defaultProps}
          item={
            {
              ...defaultProps.item,
              siblingCount: 3,
              siblingIndex: 1,
              prevSibling: 'msg-0',
              nextSibling: 'msg-2',
            } as unknown as ChatItem
          }
          switchSibling={mockSwitchSibling}
        />,
      )

      const prevBtn = screen.getByRole('button', { name: 'Previous' })
      await userEvent.setup().click(prevBtn)
      expect(mockSwitchSibling).toHaveBeenCalledWith('msg-0')

      // reset mock for next sibling click
      const nextBtn = screen.getByRole('button', { name: 'Next' })
      await userEvent.setup().click(nextBtn)
      expect(mockSwitchSibling).toHaveBeenCalledWith('msg-2')
    })
  })

  describe('Edge Cases and Props', () => {
    it('should render custom answerIcon', () => {
      render(
        <Answer
          {...defaultProps}
          answerIcon={<div data-testid="custom-answer-icon">Custom Icon</div>}
        />,
      )
      expect(screen.getByTestId('custom-answer-icon')).toBeInTheDocument()
    })

    it('should render More component', () => {
      render(
        <Answer
          {...defaultProps}
          item={
            {
              ...defaultProps.item,
              more: { latency: 1.5, tokens: 1200, time: '2026-01-01', tokens_per_second: 20 },
            } as unknown as ChatItem
          }
        />,
      )
      expect(screen.getByTestId('more-latency')).toHaveTextContent('1.5')
      expect(screen.getByTestId('more-tokens')).toHaveTextContent('1,200')
      expect(screen.getByText('20 tokens/s')).toBeInTheDocument()
    })
  })
  it('submits the actual human input form using its token and action', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <Answer
        {...defaultProps}
        item={{ ...defaultProps.item, content: '', humanInputFormDataList: [pendingForm] }}
        onHumanInputFormSubmit={onSubmit}
      />,
    )
    expect(await screen.findByText('Please approve this response.')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Approve' }))
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('form-token', {
      inputs: {},
      action: 'approve',
    })
  })

  it('expands a completed human input form to reveal its response and action', async () => {
    render(
      <Answer
        {...defaultProps}
        item={{ ...defaultProps.item, humanInputFilledFormDataList: [filledForm] }}
      />,
    )
    expect(screen.queryByText('Approved response')).not.toBeInTheDocument()
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: /chat.expand Completed review/ }))
    expect(await screen.findByText('Approved response')).toBeInTheDocument()
    expect(screen.getByTestId('executed-action')).toHaveTextContent(
      'workflowHumanInput.nodes.humanInput.userActions.triggered',
    )
  })

  it('switches siblings in the form-only layout without requiring answer text', async () => {
    const switchSibling = vi.fn()
    render(
      <Answer
        {...defaultProps}
        item={{
          ...defaultProps.item,
          content: '',
          humanInputFormDataList: [pendingForm],
          siblingCount: 2,
          siblingIndex: 1,
          prevSibling: 'previous',
        }}
        switchSibling={switchSibling}
      />,
    )
    await userEvent.setup().click(screen.getByRole('button', { name: 'Previous' }))
    expect(switchSibling).toHaveBeenCalledExactlyOnceWith('previous')
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it.each([false, true])(
    'respects workflow visibility settings with human inputs = %s',
    async (hasHumanInputs) => {
      const item: ChatItem = {
        ...defaultProps.item,
        workflowProcess: { status: WorkflowRunningStatus.Running, tracing: [] },
        humanInputFormDataList: hasHumanInputs ? [pendingForm] : undefined,
      }
      const { rerender } = render(
        <Answer
          {...defaultProps}
          item={item}
          hideProcessDetail
          appData={{
            app_id: 'app',
            custom_config: null,
            site: { title: 'App', show_workflow_steps: false },
          }}
        />,
      )
      expect(screen.queryByRole('button', { name: /workflowProcess/ })).not.toBeInTheDocument()
      rerender(
        <Answer
          {...defaultProps}
          item={item}
          hideProcessDetail
          appData={{
            app_id: 'app',
            custom_config: null,
            site: { title: 'App', show_workflow_steps: true },
          }}
        />,
      )
      const process = screen.getByRole('button', { name: /workflowProcess/ })
      expect(process).toHaveAttribute('aria-expanded', 'false')
      expect(
        screen.getByRole('img', { name: 'workflow.common.workflowProcessRunning' }),
      ).toBeInTheDocument()
      await userEvent.setup().click(process)
      expect(process).toHaveAttribute('aria-expanded', 'true')
    },
  )

  it('shows downloadable files from both generated and message attachments', async () => {
    const file = {
      id: 'generated',
      name: 'generated.pdf',
      type: 'application/pdf',
      size: 100,
      progress: 100,
      uploadedId: 'upload',
      transferMethod: TransferMethod.local_file,
      supportFileType: 'document' as const,
      url: 'https://example.com/generated.pdf',
    }
    render(
      <Answer
        {...defaultProps}
        item={{
          ...defaultProps.item,
          allFiles: [file],
          message_files: [
            { ...file, id: 'message', name: 'message.pdf', url: 'https://example.com/message.pdf' },
          ],
        }}
      />,
    )
    expect(screen.getByRole('button', { name: 'generated.pdf' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'message.pdf' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'common.operation.download' })).toHaveLength(2)
  })

  it.each([false, true])(
    'shows citation sources after streaming finishes with human inputs = %s',
    async (hasHumanInputs) => {
      const user = userEvent.setup()
      const item: ChatItem = {
        ...defaultProps.item,
        humanInputFormDataList: hasHumanInputs ? [pendingForm] : undefined,
        citation: [
          {
            content: 'Supporting passage',
            data_source_type: 'upload_file',
            dataset_name: 'Knowledge',
            dataset_id: 'dataset-1',
            document_id: 'document-1',
            document_name: 'Source.pdf',
            hit_count: 1,
            index_node_hash: 'hash',
            segment_id: 'segment-1',
            segment_position: 1,
            score: 0.9,
            word_count: 2,
          },
        ],
      }
      const { rerender } = render(<Answer {...defaultProps} item={item} responding />)
      expect(screen.queryByText('common.chat.citation.title')).not.toBeInTheDocument()
      rerender(<Answer {...defaultProps} item={item} responding={false} />)
      expect(screen.getByText('common.chat.citation.title')).toBeInTheDocument()
      const expand = screen.queryByRole('button', { name: /chat.expand.*citation.title/ })
      if (expand) await user.click(expand)
      await user.click(screen.getByRole('button', { name: 'Source.pdf' }))
      expect(await screen.findByText('Supporting passage')).toBeInTheDocument()
    },
  )
})
