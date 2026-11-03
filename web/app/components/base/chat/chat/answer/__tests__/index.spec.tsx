import type { ComponentProps } from 'react'
import type { ChatItem } from '../../../types'
import type { HumanInputFilledFormData, HumanInputFormData } from '@/types/workflow'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UserActionButtonType } from '@/app/components/workflow/nodes/human-input/types'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createChatFileFixture, createChatThoughtFixture } from '@/test/fixtures/chat'
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
    },
    question: 'Hello?',
    index: 0,
  } satisfies ComponentProps<typeof Answer>

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
          item={{
            ...defaultProps.item,
            content: '',
            agent_thoughts: [createChatThoughtFixture({ thought: 'Thinking...' })],
          }}
        />,
      )
      expect(await screen.findByText('Thinking...')).toBeInTheDocument()
    })

    it('should render custom agent content when only agent response parts exist', () => {
      render(
        <Answer
          {...defaultProps}
          item={{
            id: 'msg-with-parts',
            content: '',
            isAnswer: true,
            agent_response_parts: [{ type: 'message', content: 'streamed answer' }],
          }}
          renderAgentContent={() => <p>streamed answer</p>}
        />,
      )

      expect(screen.getByText('streamed answer')).toHaveTextContent('streamed answer')
    })

    it('should render annotation edit title', async () => {
      render(
        <Answer
          {...defaultProps}
          item={{
            ...defaultProps.item,
            annotation: { id: 'a1', authorName: 'John Doe' },
          }}
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
          item={{
            ...defaultProps.item,
            // Thinking ⇒ the answer has not started yet, so content must be empty.
            content: '',
            reasoningContent: { llm: 'deep thought' },
          }}
        />,
      )
      expect(screen.getByText(/chat\.thinking/)).toBeInTheDocument()
    })

    it('should render the reasoning panel in the thought state once finished', () => {
      render(
        <Answer
          {...defaultProps}
          item={{
            ...defaultProps.item,
            reasoningContent: { llm: 'recalled reasoning' },
            reasoningFinished: true,
          }}
        />,
      )
      expect(screen.getByText(/chat\.thought/)).toBeInTheDocument()
    })

    it('should render the reasoning panel within the human-input layout', () => {
      render(
        <Answer
          {...defaultProps}
          item={{
            ...defaultProps.item,
            reasoningContent: { llm: 'human-input reasoning' },
            humanInputFormDataList: [pendingForm],
          }}
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
          item={{
            ...defaultProps.item,
            content: '',
            reasoningContent: { llm: 'reload reasoning' },
            reasoningFinished: true,
            humanInputFilledFormDataList: [filledForm],
          }}
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
          item={{
            ...defaultProps.item,
            reasoningContent: {},
          }}
        />,
      )
      expect(screen.queryByText(/chat\.(thinking|thought)/)).not.toBeInTheDocument()
    })
  })

  describe('Interactions', () => {
    it('should handle switch sibling', async () => {
      const user = userEvent.setup()
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
          }}
          switchSibling={mockSwitchSibling}
        />,
      )

      const prevBtn = screen.getByRole('button', { name: 'Previous' })
      await user.click(prevBtn)
      expect(mockSwitchSibling).toHaveBeenCalledWith('msg-0')

      const nextBtn = screen.getByRole('button', { name: 'Next' })
      await user.click(nextBtn)
      expect(mockSwitchSibling).toHaveBeenCalledWith('msg-2')
    })
  })

  describe('Edge Cases and Props', () => {
    it('should render custom answerIcon', () => {
      render(
        <Answer {...defaultProps} answerIcon={<span role="img" aria-label="Assistant avatar" />} />,
      )
      expect(screen.getByRole('img', { name: 'Assistant avatar' })).toBeInTheDocument()
    })

    it('should render More component', () => {
      render(
        <Answer
          {...defaultProps}
          item={{
            ...defaultProps.item,
            more: { latency: 1.5, tokens: 1200, time: '2026-01-01', tokens_per_second: 20 },
          }}
        />,
      )
      expect(
        screen.getByText('appLog.detail.timeConsuming 1.5appLog.detail.second'),
      ).toBeInTheDocument()
      expect(screen.getByText('appLog.detail.tokenCost 1,200')).toBeInTheDocument()
      expect(screen.getByText('20 tokens/s')).toBeInTheDocument()
    })
  })
  it('submits the actual human input form using its token and action', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <Answer
        {...defaultProps}
        item={{ ...defaultProps.item, content: '', humanInputFormDataList: [pendingForm] }}
        onHumanInputFormSubmit={onSubmit}
      />,
    )
    expect(await screen.findByText('Please approve this response.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Approve' }))
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('form-token', {
      inputs: {},
      action: 'approve',
    })
  })

  it('expands a completed human input form to reveal its response and action', async () => {
    const user = userEvent.setup()
    render(
      <Answer
        {...defaultProps}
        item={{ ...defaultProps.item, humanInputFilledFormDataList: [filledForm] }}
      />,
    )
    expect(screen.queryByText('Approved response')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /chat.expand Completed review/ }))
    expect(await screen.findByText('Approved response')).toBeInTheDocument()
    expect(screen.getByTestId('executed-action')).toHaveTextContent(
      'workflowHumanInput.nodes.humanInput.userActions.triggered',
    )
  })

  it('switches siblings in the form-only layout without requiring answer text', async () => {
    const user = userEvent.setup()
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
    await user.click(screen.getByRole('button', { name: 'Previous' }))
    expect(switchSibling).toHaveBeenCalledExactlyOnceWith('previous')
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it.each([false, true])(
    'respects workflow visibility settings with human inputs = %s',
    async (hasHumanInputs) => {
      const user = userEvent.setup()
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
      await user.click(process)
      expect(process).toHaveAttribute('aria-expanded', 'true')
    },
  )

  it('shows downloadable files from both generated and message attachments', async () => {
    const file = createChatFileFixture({
      id: 'generated',
      name: 'generated.pdf',
      type: 'application/pdf',
      url: 'https://example.com/generated.pdf',
    })
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
      await user.click(screen.getByRole('button', { name: 'Source.pdf' }))
      expect(await screen.findByText('Supporting passage')).toBeInTheDocument()
    },
  )
})
