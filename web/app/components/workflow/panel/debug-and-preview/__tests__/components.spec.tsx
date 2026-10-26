import type { PaginatedConversationVariableResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { EventEmitter } from 'ahooks/lib/useEventEmitter'
import type { ComponentProps } from 'react'
import type { useWorkflowRun } from '../../../hooks/use-workflow-run'
import type { ChatWrapperRefType } from '../index'
import type Chat from '@/app/components/base/chat/chat'
import type { ConversationVariable } from '@/app/components/workflow/types'
import type { EventEmitterValue } from '@/context/event-emitter'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import copy from 'copy-to-clipboard'
import { createRef } from 'react'
import { FeaturesProvider } from '@/app/components/base/features/context'
import { createStartNode } from '@/app/components/workflow/__tests__/fixtures'
import {
  renderWorkflowComponent as renderWorkflowComponentBase,
  renderWorkflowFlowComponent as renderWorkflowFlowComponentBase,
} from '@/app/components/workflow/__tests__/workflow-test-env'
import { ChatVarType } from '@/app/components/workflow/panel/chat-variable-panel/type'
import { InputVarType } from '@/app/components/workflow/types'
import { EVENT_WORKFLOW_STOP } from '@/app/components/workflow/variable-inspect/types'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import ChatWrapper from '../chat-wrapper'
import ConversationVariableModal from '../conversation-variable-modal'
import UserInput from '../user-input'

type HandleRun = ReturnType<typeof useWorkflowRun>['handleRun']
const handleRun = vi.fn<HandleRun>()
const callbacks = () => handleRun.mock.calls.at(-1)![1]!
let emitter: EventEmitter<EventEmitterValue>
const { mockRequest, submitHumanInputForm } = vi.hoisted(() => ({
  mockRequest: vi.fn(),
  submitHumanInputForm: vi.fn(),
}))
vi.mock('copy-to-clipboard', () => ({ default: vi.fn() }))
vi.mock('@/service/console/browser', () => ({ consoleBrowserLink: { call: mockRequest } }))
vi.mock('@/service/workflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/workflow')>()),
  submitHumanInputForm,
}))
vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({ formatTime: (timestamp: number) => `formatted-${timestamp}` }),
}))
// Monaco renders the runtime value; its editing behavior is outside this read-only modal.
vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor', () => ({
  default: ({ value }: { value?: string }) => (
    <pre data-testid="conversation-code-editor">{value}</pre>
  ),
}))

// Shared Chat UI is independently tested; the preview's real useChat owns the conversation tree and stream.
vi.mock('@/app/components/base/chat/chat', () => ({
  default: ({
    chatList,
    chatNode,
    inputDisabled,
    isResponding,
    suggestedQuestions,
    onSend,
    onRegenerate,
    switchSibling,
    onHumanInputFormSubmit,
  }: ComponentProps<typeof Chat>) => (
    <>
      <div role="log" aria-label="Conversation">
        {chatList.map((item) => (
          <p key={item.id}>{item.content}</p>
        ))}
      </div>
      <output aria-label="Response state">{isResponding ? 'Responding' : 'Idle'}</output>
      {suggestedQuestions?.map((question) => (
        <p key={question}>{question}</p>
      ))}
      <button type="button" disabled={inputDisabled} onClick={() => onSend?.('hello', [])}>
        send-chat
      </button>
      <button type="button" onClick={() => onRegenerate?.(chatList.at(-1)!)}>
        regenerate-chat
      </button>
      <button type="button" onClick={() => switchSibling?.('answer-1')}>
        switch-sibling
      </button>
      <button
        type="button"
        onClick={() =>
          onHumanInputFormSubmit?.('token-1', {
            inputs: { answer: 'ok' },
            action: 'approve',
          })
        }
      >
        submit-human-input
      </button>
      {chatNode}
    </>
  ),
}))

function EventProbe() {
  emitter = useEventEmitterContextContext().eventEmitter!
  return null
}
const Providers = ({ children }: { children: React.ReactNode }) => (
  <EventEmitterContextProvider>
    <EventProbe />
    <FeaturesProvider features={{ suggested: { enabled: true } }}>{children}</FeaturesProvider>
  </EventEmitterContextProvider>
)
const renderWorkflowComponent = (
  ui: React.ReactElement,
  options?: Parameters<typeof renderWorkflowComponentBase>[1],
) => renderWorkflowComponentBase(<Providers>{ui}</Providers>, options)
const renderWorkflowFlowComponent = (
  ui: React.ReactElement,
  options?: Parameters<typeof renderWorkflowFlowComponentBase>[1],
) =>
  renderWorkflowFlowComponentBase(<Providers>{ui}</Providers>, {
    ...options,
    hooksStoreProps: { handleRun, ...options?.hooksStoreProps },
  })
const mockCopy = vi.mocked(copy)
const createConversationVariable = (
  overrides: Partial<ConversationVariable> = {},
): ConversationVariable => ({
  id: 'var-1',
  name: 'session_state',
  description: 'Session state',
  value_type: ChatVarType.Object,
  value: '{"draft":true}',
  ...overrides,
})
const createConversationVariableResponse = (
  data: PaginatedConversationVariableResponse['data'] = [],
): PaginatedConversationVariableResponse => ({
  data,
  has_more: false,
  limit: 20,
  total: data.length,
  page: 1,
})
const createChatWrapperRef = () => createRef<ChatWrapperRefType>()
const sendChunk = (answer: string, id: string, taskId = 'task-1') => {
  act(() =>
    callbacks().onData?.(answer, true, { conversationId: 'conversation-1', messageId: id, taskId }),
  )
}
const complete = async () => {
  await act(async () => {
    await callbacks().onCompleted?.(false)
  })
}

describe('debug-and-preview components', () => {
  beforeEach(() => {
    handleRun.mockReset()
    submitHumanInputForm.mockReset().mockResolvedValue(undefined)
    mockRequest
      .mockReset()
      .mockImplementation(async (path: string[]) =>
        path.includes('suggestedQuestions')
          ? { data: ['Try another question'] }
          : createConversationVariableResponse(),
      )
  })
  afterEach(() => vi.useRealTimers())
  describe('ConversationVariableModal', () => {
    it('copies the displayed runtime value and re-enables copying after the timeout', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      mockRequest.mockResolvedValue(
        createConversationVariableResponse([
          {
            ...createConversationVariable({ value: '{"latest":true}' }),
            updated_at: 100,
            created_at: 50,
          },
        ]),
      )
      renderWorkflowComponent(
        <ConversationVariableModal conversationID="conversation-1" onHide={vi.fn()} />,
        {
          resource: { kind: 'app' as const, appId: 'app-1', mode: 'workflow' as const },
          initialStoreState: {
            conversationVariables: [createConversationVariable()],
          },
        },
      )

      await waitFor(() =>
        expect(screen.getByTestId('conversation-code-editor')).toHaveTextContent('{"latest":true}'),
      )
      const copyTrigger = screen.getByRole('button', { name: 'common.operation.copy' })
      await user.click(copyTrigger)
      expect(mockCopy).toHaveBeenCalledExactlyOnceWith('{"latest":true}')
      expect(copyTrigger).toHaveAttribute('aria-disabled', 'true')
      await user.click(copyTrigger)
      expect(mockCopy).toHaveBeenCalledTimes(1)

      act(() => {
        vi.advanceTimersByTime(2000)
      })
      expect(copyTrigger).toHaveAttribute('aria-disabled', 'false')
      await user.click(copyTrigger)
      expect(mockCopy).toHaveBeenCalledTimes(2)
    })
  })

  describe('UserInput', () => {
    it('should hide secret fields outside the expanded panel and persist edits into workflow state', async () => {
      const user = userEvent.setup()
      const { store } = renderWorkflowFlowComponent(<UserInput />, {
        nodes: [
          createStartNode({
            data: {
              variables: [
                {
                  type: InputVarType.textInput,
                  variable: 'question',
                  label: 'Question',
                },
                {
                  type: InputVarType.textInput,
                  variable: 'internal_note',
                  label: 'Internal Note',
                  hide: true,
                },
              ],
            },
          }),
        ],
        edges: [],
        initialStoreState: {
          inputs: {
            question: 'draft',
          },
          showDebugAndPreviewPanel: false,
        },
      })

      expect(screen.getByLabelText('Question')).toBeInTheDocument()
      expect(screen.queryByLabelText('Internal Note')).not.toBeInTheDocument()

      await user.clear(screen.getByLabelText('Question'))
      await user.type(screen.getByLabelText('Question'), 'updated draft')

      expect(store.getState().inputs).toEqual({
        question: 'updated draft',
      })
    })

    it('should reveal hidden fields when the debug-and-preview panel is expanded', () => {
      renderWorkflowFlowComponent(<UserInput />, {
        nodes: [
          createStartNode({
            data: {
              variables: [
                {
                  type: InputVarType.textInput,
                  variable: 'internal_note',
                  label: 'Internal Note',
                  hide: true,
                },
              ],
            },
          }),
        ],
        edges: [],
        initialStoreState: {
          inputs: {},
          showDebugAndPreviewPanel: true,
        },
      })

      expect(screen.getByLabelText('Internal Note')).toBeInTheDocument()
    })
  })

  describe('ChatWrapper', () => {
    it('seeds start defaults, then restarting clears the conversation and restores inputs', async () => {
      const user = userEvent.setup()
      const chatRef = createChatWrapperRef()
      const { store } = renderWorkflowFlowComponent(
        <ChatWrapper
          ref={chatRef}
          showConversationVariableModal={false}
          onConversationModalHide={vi.fn()}
          showInputsFieldsPanel
          onHide={vi.fn()}
        />,
        {
          nodes: [
            createStartNode({
              data: {
                variables: [
                  {
                    type: InputVarType.textInput,
                    variable: 'name',
                    label: 'Name',
                    default: 'Ada',
                  },
                ],
              },
            }),
          ],
          initialStoreState: { inputs: { custom: 'value' } },
        },
      )
      expect(store.getState().inputs).toEqual({ custom: 'value', name: 'Ada' })
      expect(screen.getByText('workflow.common.previewPlaceholder')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'send-chat' }))
      sendChunk('A saved answer', 'answer-1')
      expect(screen.getByRole('log', { name: 'Conversation' })).toHaveTextContent('A saved answer')
      act(() => chatRef.current!.handleRestart())
      expect(screen.getByRole('log', { name: 'Conversation' })).toBeEmptyDOMElement()
      expect(screen.getByLabelText('Response state')).toHaveTextContent('Idle')
      expect(screen.getByText('workflow.common.previewPlaceholder')).toBeInTheDocument()
      expect(store.getState().inputs).toEqual({ name: 'Ada' })
    })

    it('preserves zero and false defaults when initializing and restarting after input edits', async () => {
      const user = userEvent.setup()
      const chatRef = createChatWrapperRef()
      const { store } = renderWorkflowFlowComponent(
        <ChatWrapper
          ref={chatRef}
          showConversationVariableModal={false}
          onConversationModalHide={vi.fn()}
          showInputsFieldsPanel
          onHide={vi.fn()}
        />,
        {
          nodes: [
            createStartNode({
              data: {
                variables: [
                  { variable: 'count', label: 'Count', type: InputVarType.number, default: 0 },
                  {
                    variable: 'ready',
                    label: 'Ready',
                    type: InputVarType.checkbox,
                    default: false,
                  },
                ],
              },
            }),
          ],
        },
      )
      expect(store.getState().inputs).toEqual({ count: 0, ready: false })
      await user.clear(screen.getByLabelText('Count'))
      await user.type(screen.getByLabelText('Count'), '8')
      await user.click(screen.getByRole('checkbox', { name: /^Ready/ }))
      expect(store.getState().inputs).toEqual({ count: 8, ready: true })
      act(() => chatRef.current!.handleRestart())
      expect(store.getState().inputs).toEqual({ count: 0, ready: false })
      expect(screen.getByLabelText('Count')).toHaveValue('0')
      expect(screen.getByRole('checkbox', { name: /^Ready/ })).not.toBeChecked()
    })

    it('disables sending when the active response pauses', async () => {
      const user = userEvent.setup()
      renderWorkflowFlowComponent(
        <ChatWrapper
          ref={createChatWrapperRef()}
          showConversationVariableModal={false}
          onConversationModalHide={vi.fn()}
          showInputsFieldsPanel={false}
          onHide={vi.fn()}
        />,
      )
      const send = screen.getByRole('button', { name: 'send-chat' })
      await user.click(send)
      const envelope = { task_id: 'task-1', workflow_run_id: 'run-1' }
      act(() => {
        callbacks().onWorkflowStarted?.({
          ...envelope,
          event: 'workflow_started',
          message_id: 'answer-1',
          data: { id: 'run-1', workflow_id: 'workflow-1', created_at: 1 },
        })
        callbacks().onWorkflowPaused?.({
          ...envelope,
          event: 'workflow_paused',
          data: {
            workflow_run_id: 'run-1',
            paused_nodes: ['human-input'],
            reasons: [],
            outputs: {},
          },
        })
      })
      await complete()
      expect(send).toBeDisabled()
      expect(screen.getByLabelText('Response state')).toHaveTextContent('Idle')
      await user.click(send)
      expect(screen.getByRole('log', { name: 'Conversation' })).toHaveTextContent('hello')
    })

    it('renders streamed answers, regenerates and switches siblings, and stops through the event bus', async () => {
      const user = userEvent.setup()
      const onHide = vi.fn()
      const chatRef = createChatWrapperRef()
      const view = (showConversationVariableModal = false) => (
        <Providers>
          <ChatWrapper
            ref={chatRef}
            showConversationVariableModal={showConversationVariableModal}
            onConversationModalHide={vi.fn()}
            showInputsFieldsPanel={false}
            onHide={onHide}
          />
        </Providers>
      )
      const { rerender } = renderWorkflowFlowComponent(
        <ChatWrapper
          ref={chatRef}
          showConversationVariableModal={false}
          onConversationModalHide={vi.fn()}
          showInputsFieldsPanel={false}
          onHide={onHide}
        />,
        {
          nodes: [
            createStartNode({
              data: {
                variables: [
                  {
                    type: InputVarType.textInput,
                    variable: 'name',
                    label: 'Name',
                    default: 'Ada',
                  },
                ],
              },
            }),
          ],
          initialStoreState: {
            inputs: { existing: 'value' },
            conversationVariables: [createConversationVariable()],
          },
        },
      )
      await user.click(screen.getByRole('button', { name: 'send-chat' }))
      expect(handleRun).toHaveBeenLastCalledWith(
        expect.objectContaining({
          query: 'hello',
          inputs: { existing: 'value', name: 'Ada' },
        }),
        expect.any(Object),
      )
      expect(onHide).toHaveBeenCalledOnce()
      expect(screen.getByLabelText('Response state')).toHaveTextContent('Responding')
      sendChunk('First answer', 'answer-1')
      await complete()
      expect(screen.getByRole('log', { name: 'Conversation' })).toHaveTextContent('First answer')
      expect(await screen.findByText('Try another question')).toBeInTheDocument()
      expect(mockRequest).toHaveBeenCalledWith(
        ['apps', 'byAppId', 'chatMessages', 'byMessageId', 'suggestedQuestions', 'get'],
        { params: { app_id: 'app-1', message_id: 'answer-1' } },
        expect.any(Object),
      )
      await user.click(screen.getByRole('button', { name: 'regenerate-chat' }))
      sendChunk('Second answer', 'answer-2')
      await complete()
      expect(screen.getByRole('log', { name: 'Conversation' })).toHaveTextContent('Second answer')
      await user.click(screen.getByRole('button', { name: 'switch-sibling' }))
      expect(screen.getByRole('log', { name: 'Conversation' })).toHaveTextContent('First answer')
      expect(screen.queryByText('Second answer')).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'submit-human-input' }))
      expect(submitHumanInputForm).toHaveBeenCalledExactlyOnceWith('token-1', {
        inputs: { answer: 'ok' },
        action: 'approve',
      })
      await user.click(screen.getByRole('button', { name: 'send-chat' }))
      sendChunk('Pending answer', 'answer-3', 'task-3')
      act(() => emitter.emit({ type: 'unrelated-event' }))
      expect(screen.getByLabelText('Response state')).toHaveTextContent('Responding')
      act(() => emitter.emit({ type: EVENT_WORKFLOW_STOP }))
      expect(screen.getByLabelText('Response state')).toHaveTextContent('Idle')
      await waitFor(() =>
        expect(mockRequest).toHaveBeenCalledWith(
          ['apps', 'byAppId', 'chatMessages', 'byTaskId', 'stop', 'post'],
          { params: { app_id: 'app-1', task_id: 'task-3' } },
          expect.any(Object),
        ),
      )
      mockRequest.mockResolvedValue(
        createConversationVariableResponse([
          {
            ...createConversationVariable({ value: '{"latest":1}' }),
            updated_at: 100,
            created_at: 50,
          },
        ]),
      )
      rerender(view(true))
      expect(await screen.findByRole('dialog')).toBeInTheDocument()
      expect(await screen.findByText('{"latest":1}')).toBeInTheDocument()
    })
  })
})
