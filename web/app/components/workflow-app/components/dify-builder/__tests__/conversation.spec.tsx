import type { ConversationItem, FormField } from '../types'
import type { FileUpload } from '@/app/components/base/features/types'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider } from 'jotai'
import { DifyBuilderConversation } from '../conversation'
import {
  difyBuilderExecutionProgressAtom,
  difyBuilderReasoningAtom,
  difyBuilderStreamingTurnAtom,
} from '../session/state'

const mocks = vi.hoisted(() => ({
  fileUploader: vi.fn(),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: <T,>(
    selector: (state: { fileUploadConfig: { workflow_file_upload_limit: number } }) => T,
  ) =>
    selector({
      fileUploadConfig: { workflow_file_upload_limit: 4 },
    }),
}))

vi.mock('@/app/components/base/markdown', () => ({
  Markdown: ({ content }: { content: string }) => <p>{content}</p>,
}))

vi.mock('@/app/components/base/file-uploader', () => ({
  FileUploaderInAttachmentWrapper: ({
    fileConfig,
    isDisabled,
    onChange,
  }: {
    fileConfig: FileUpload
    isDisabled?: boolean
    onChange: (files: FileEntity[]) => void
  }) => {
    mocks.fileUploader(fileConfig)
    const pendingFile: FileEntity = {
      id: 'pending-file',
      name: 'pending.pdf',
      size: 512,
      type: 'application/pdf',
      progress: 50,
      transferMethod: 'local_file',
      supportFileType: 'document',
    }
    const uploadedFile: FileEntity = {
      ...pendingFile,
      id: 'uploaded-file',
      name: 'report.pdf',
      progress: 100,
      uploadedId: 'upload-1',
    }

    return (
      <div>
        <button type="button" disabled={isDisabled} onClick={() => onChange([pendingFile])}>
          Start file upload
        </button>
        <button type="button" disabled={isDisabled} onClick={() => onChange([uploadedFile])}>
          Upload completed file
        </button>
      </div>
    )
  },
}))

const renderForm = (
  fields: FormField[],
  values: Record<string, unknown> = {},
  onActionPayloadChange = vi.fn(),
  onActionValidityChange = vi.fn(),
) => {
  const card: Extract<ConversationItem, { kind: 'form' }> = {
    seq: 0,
    at_version: 1,
    kind: 'form',
    payload: { variant: 'testdata', fields, values },
  }
  render(
    <DifyBuilderConversation
      busy={false}
      activeInteraction={{
        action_id: 'provide_testdata',
        card,
        valid_at_version: 1,
      }}
      changesExpanded={false}
      interrupted={false}
      items={[card]}
      onActionPayloadChange={onActionPayloadChange}
      onActionValidityChange={onActionValidityChange}
    />,
  )

  return { onActionPayloadChange, onActionValidityChange }
}

describe('DifyBuilderConversation test data form', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('submits parsed JSON while preserving number and checkbox value types', async () => {
    const user = userEvent.setup()
    const { onActionPayloadChange, onActionValidityChange } = renderForm([
      { key: 'profile', label: 'Profile', type: 'json_object' },
      { key: 'metadata', label: 'Metadata', type: 'json' },
      { key: 'retries', label: 'Retries', type: 'number' },
      { key: 'enabled', label: 'Enabled', type: 'checkbox' },
    ])

    await user.click(screen.getByRole('textbox', { name: 'Profile' }))
    await user.paste('{"name":"Ada"}')
    await user.click(screen.getByRole('textbox', { name: 'Metadata' }))
    await user.paste('{"tags":["builder"]}')
    await user.type(screen.getByRole('spinbutton', { name: 'Retries' }), '3')
    await user.click(screen.getByRole('checkbox', { name: 'Enabled' }))

    await waitFor(() => {
      expect(onActionPayloadChange).toHaveBeenLastCalledWith('provide_testdata', {
        mode: 'provide',
        inputs: {
          profile: { name: 'Ada' },
          metadata: { tags: ['builder'] },
          retries: 3,
          enabled: true,
        },
      })
    })
    expect(onActionValidityChange).toHaveBeenLastCalledWith('provide_testdata', true)
  })

  it('uses defaults and keeps the action invalid until required fields are complete', async () => {
    const user = userEvent.setup()
    const { onActionPayloadChange, onActionValidityChange } = renderForm([
      {
        key: 'query',
        label: 'Query',
        type: 'text-input',
        required: true,
        max_length: 5,
        placeholder: 'Ask',
      },
      {
        key: 'locale',
        label: 'Locale',
        type: 'select',
        options: ['en', 'zh'],
        required: true,
        default: 'en',
      },
    ])
    const query = screen.getByRole('textbox', { name: /Query/ })
    const locale = screen.getByRole('combobox', { name: /Locale/ })

    expect(query).toBeRequired()
    expect(query).toHaveAttribute('maxlength', '5')
    expect(query).toHaveAttribute('placeholder', 'Ask')
    expect(locale).toHaveTextContent('en')
    await waitFor(() => {
      expect(onActionValidityChange).toHaveBeenLastCalledWith('provide_testdata', false)
    })

    await user.click(locale)
    await user.click(screen.getByRole('option', { name: 'zh' }))
    await user.type(query, 'hello')

    await waitFor(() => {
      expect(onActionPayloadChange).toHaveBeenLastCalledWith('provide_testdata', {
        mode: 'provide',
        inputs: { locale: 'zh', query: 'hello' },
      })
      expect(onActionValidityChange).toHaveBeenLastCalledWith('provide_testdata', true)
    })
  })

  it('reports an accessible error and invalid action state for malformed JSON', async () => {
    const user = userEvent.setup()
    const { onActionValidityChange } = renderForm([
      { key: 'profile', label: 'Profile', type: 'json_object' },
    ])
    const input = screen.getByRole('textbox', { name: 'Profile' })

    await user.click(input)
    await user.paste('{"name":')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('workflow.errorMsg.invalidJson')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAttribute('aria-describedby', alert.id)
    expect(onActionValidityChange).toHaveBeenLastCalledWith('provide_testdata', false)

    await user.clear(input)
    await user.paste('{"name":"Ada"}')

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(input).not.toHaveAttribute('aria-invalid')
    await waitFor(() => {
      expect(onActionValidityChange).toHaveBeenLastCalledWith('provide_testdata', true)
    })
  })

  it('renders file inputs as uploaders and emits workflow file DTOs after upload', async () => {
    const user = userEvent.setup()
    const { onActionPayloadChange, onActionValidityChange } = renderForm([
      {
        key: 'document',
        label: 'Document',
        type: 'file',
        required: true,
        allowed_file_types: ['document'],
        allowed_file_extensions: ['pdf'],
        allowed_file_upload_methods: ['local_file'],
      },
      {
        key: 'attachments',
        label: 'Attachments',
        type: 'file-list',
        number_limits: 2,
      },
      { key: 'images', label: 'Images', type: 'files' },
    ])
    const documentField = screen.getByRole('group', { name: 'Document' })

    expect(screen.queryByRole('textbox', { name: 'Document' })).not.toBeInTheDocument()
    expect(mocks.fileUploader.mock.calls[0]?.[0]).toMatchObject({
      allowed_file_types: ['document'],
      allowed_file_extensions: ['pdf'],
      allowed_file_upload_methods: ['local_file'],
      number_limits: 1,
    })
    expect(mocks.fileUploader.mock.calls[1]?.[0]).toMatchObject({ number_limits: 2 })
    expect(mocks.fileUploader.mock.calls[2]?.[0]).toMatchObject({ number_limits: 4 })
    await user.click(within(documentField).getByRole('button', { name: 'Start file upload' }))
    await waitFor(() => {
      expect(onActionValidityChange).toHaveBeenLastCalledWith('provide_testdata', false)
    })

    await user.click(within(documentField).getByRole('button', { name: 'Upload completed file' }))
    await user.click(
      within(screen.getByRole('group', { name: 'Attachments' })).getByRole('button', {
        name: 'Upload completed file',
      }),
    )
    await user.click(
      within(screen.getByRole('group', { name: 'Images' })).getByRole('button', {
        name: 'Upload completed file',
      }),
    )

    const fileDto = {
      type: 'document',
      transfer_method: 'local_file',
      url: '',
      upload_file_id: 'upload-1',
    }
    await waitFor(() => {
      expect(onActionPayloadChange).toHaveBeenLastCalledWith('provide_testdata', {
        mode: 'provide',
        inputs: {
          document: fileDto,
          attachments: [fileDto],
          images: [fileDto],
        },
      })
    })
    expect(onActionValidityChange).toHaveBeenLastCalledWith('provide_testdata', true)
  })

  it('preserves form input while the isolated assistant tail streams', async () => {
    const user = userEvent.setup()
    const store = createStore()
    const card: Extract<ConversationItem, { kind: 'form' }> = {
      seq: 0,
      at_version: 1,
      kind: 'form',
      payload: {
        variant: 'testdata',
        fields: [{ key: 'topic', label: 'Topic', type: 'text-input' }],
        values: {},
      },
    }
    render(
      <Provider store={store}>
        <DifyBuilderConversation
          busy={false}
          activeInteraction={{
            action_id: 'provide_testdata',
            card,
            valid_at_version: 1,
          }}
          changesExpanded={false}
          interrupted={false}
          items={[card]}
          onActionPayloadChange={vi.fn()}
          onActionValidityChange={vi.fn()}
        />
      </Provider>,
    )
    const input = screen.getByRole('textbox', { name: 'Topic' })
    await user.type(input, 'AI agents')

    act(() => {
      store.set(difyBuilderExecutionProgressAtom, {
        sessionId: 'session-1',
        operationId: 'operation-1',
        stageId: 'build.test',
        atVersion: 2,
        revision: 1,
        execution: {
          status: 'running',
          activities: [
            {
              id: 'build-check-inputs',
              label: 'Check test inputs',
              state: 'active',
            },
          ],
        },
      })
      store.set(difyBuilderReasoningAtom, {
        sessionId: 'session-1',
        operationId: 'operation-1',
        stageId: 'build.test',
        atVersion: 2,
        revision: 1,
        text: 'Inspecting the supplied test data.',
      })
      store.set(difyBuilderStreamingTurnAtom, {
        sessionId: 'session-1',
        operationId: 'operation-1',
        turnId: 'turn-1',
        sequence: 1,
        atVersion: 2,
        revision: 1,
        stageId: 'build.test',
        replyText: 'Checking the workflow',
      })
    })

    expect(input).toHaveValue('AI agents')
    expect(screen.getByRole('status')).toHaveTextContent('Check test inputs')
    expect(screen.getByText('Inspecting the supplied test data.')).toBeInTheDocument()
    expect(screen.getByText('Checking the workflow')).toBeInTheDocument()
  })

  it('announces committed messages as a labelled log without putting streaming tokens in it', () => {
    const store = createStore()
    store.set(difyBuilderStreamingTurnAtom, {
      sessionId: 'session-1',
      operationId: 'operation-1',
      turnId: 'turn-streaming',
      sequence: 1,
      atVersion: 2,
      revision: 1,
      stageId: 'build.test',
      replyText: 'Streaming reply',
    })

    render(
      <Provider store={store}>
        <DifyBuilderConversation
          busy
          activeInteraction={null}
          changesExpanded={false}
          interrupted={false}
          items={[
            {
              seq: 0,
              at_version: 1,
              kind: 'user',
              payload: { text: 'Build a support workflow', turn_id: 'turn-user-1' },
            },
            {
              seq: 1,
              at_version: 1,
              kind: 'assistant_turn',
              payload: {
                turn_id: 'turn-assistant-1',
                stage_id: 'build.plan',
                execution: { status: 'completed' },
                reply_text: 'The plan is ready.',
              },
            },
          ]}
          onActionPayloadChange={vi.fn()}
        />
      </Provider>,
    )

    const log = screen.getByRole('log', { name: 'workflow.difyBuilder.panelTitle' })
    expect(log).toHaveAttribute('aria-live', 'polite')
    expect(log).toHaveAttribute('aria-relevant', 'additions')
    expect(within(log).getByRole('heading', { name: 'common.you' })).toBeInTheDocument()
    expect(
      within(log).getByRole('heading', { name: 'workflow.difyBuilder.panelTitle' }),
    ).toBeInTheDocument()
    expect(log).toContainElement(screen.getByText('The plan is ready.'))
    expect(log).not.toContainElement(screen.getByText('Streaming reply'))
  })

  it('keeps a stable status while an assistant reply streams without execution steps', () => {
    const store = createStore()
    store.set(difyBuilderStreamingTurnAtom, {
      sessionId: 'session-1',
      operationId: 'operation-1',
      turnId: 'turn-streaming',
      sequence: 1,
      atVersion: 2,
      revision: 1,
      stageId: 'build.test',
      replyText: 'Streaming reply',
    })

    render(
      <Provider store={store}>
        <DifyBuilderConversation
          busy
          activeInteraction={null}
          changesExpanded={false}
          interrupted={false}
          items={[]}
          onActionPayloadChange={vi.fn()}
        />
      </Provider>,
    )

    expect(screen.getByRole('status')).toHaveTextContent('workflow.common.running')
  })

  it('lets the visible resource label toggle its checkbox and describes it with metadata', async () => {
    const user = userEvent.setup()
    const onActionPayloadChange = vi.fn()
    const resourceCard: Extract<ConversationItem, { kind: 'resource_select' }> = {
      seq: 0,
      at_version: 1,
      kind: 'resource_select',
      payload: {
        recommended: [
          {
            id: 'knowledge-base-1',
            kind: 'dataset',
            label: 'Support knowledge base',
            meta: '12 documents',
            readiness: 'ready',
          },
        ],
      },
    }

    render(
      <DifyBuilderConversation
        busy={false}
        activeInteraction={{
          action_id: 'confirm_resources',
          card: resourceCard,
          valid_at_version: 1,
        }}
        changesExpanded={false}
        interrupted={false}
        items={[resourceCard]}
        onActionPayloadChange={onActionPayloadChange}
      />,
    )

    const checkbox = screen.getByRole('checkbox', { name: 'Support knowledge base' })
    expect(checkbox).toBeChecked()
    expect(checkbox).toHaveAccessibleDescription('12 documents')

    await user.click(screen.getByText('Support knowledge base'))

    expect(checkbox).not.toBeChecked()
    expect(onActionPayloadChange).toHaveBeenLastCalledWith('confirm_resources', {
      resource_ids: [],
      conflict_policy: 'ask',
    })
  })

  it('restores the current interaction separately and freezes historical forms', async () => {
    const user = userEvent.setup()
    const oldCard: Extract<ConversationItem, { kind: 'form' }> = {
      seq: 2,
      at_version: 2,
      kind: 'form',
      payload: {
        variant: 'testdata',
        fields: [{ key: 'topic', label: 'Topic', type: 'text-input' }],
        values: { topic: 'old value' },
      },
    }
    const activeCard: Extract<ConversationItem, { kind: 'form' }> = {
      seq: 8,
      at_version: 5,
      kind: 'form',
      payload: {
        variant: 'testdata',
        fields: [{ key: 'topic', label: 'Topic', type: 'text-input' }],
        values: { topic: 'restored value' },
      },
    }
    const onActionPayloadChange = vi.fn()

    render(
      <DifyBuilderConversation
        busy={false}
        activeInteraction={{
          action_id: 'provide_testdata',
          card: activeCard,
          valid_at_version: 5,
        }}
        changesExpanded={false}
        interrupted={false}
        items={[oldCard]}
        onActionPayloadChange={onActionPayloadChange}
      />,
    )

    const [historicalInput, activeInput] = screen.getAllByRole('textbox', { name: 'Topic' })
    expect(historicalInput).toBeDisabled()
    expect(historicalInput).toHaveValue('old value')
    expect(activeInput).toBeEnabled()
    expect(activeInput).toHaveValue('restored value')

    await user.clear(activeInput!)
    await user.type(activeInput!, 'new value')
    await waitFor(() =>
      expect(onActionPayloadChange).toHaveBeenLastCalledWith('provide_testdata', {
        mode: 'provide',
        inputs: { topic: 'new value' },
      }),
    )
  })

  it('keeps completed execution and reasoning available with the committed reply', () => {
    render(
      <DifyBuilderConversation
        busy={false}
        activeInteraction={null}
        changesExpanded={false}
        interrupted={false}
        items={[
          {
            seq: 0,
            at_version: 2,
            kind: 'assistant_turn',
            payload: {
              turn_id: 'turn-1',
              stage_id: 'build.initial_plan',
              execution: {
                status: 'completed',
                activities: [
                  {
                    id: 'build-draft-plan',
                    label: 'Draft the workflow plan',
                    state: 'done',
                  },
                ],
              },
              reasoning_text: 'The workflow needs one input and one answer node.',
              reply_text: 'The plan is ready.',
            },
          },
        ]}
        onActionPayloadChange={vi.fn()}
      />,
    )

    expect(screen.getAllByText('Draft the workflow plan')).toHaveLength(2)
    expect(
      screen.getByText('The workflow needs one input and one answer node.'),
    ).toBeInTheDocument()
    expect(screen.getByText('The plan is ready.')).toBeInTheDocument()
  })

  it('hides challenge, change set, and checkpoint cards from the committed conversation', () => {
    render(
      <DifyBuilderConversation
        busy={false}
        activeInteraction={null}
        changesExpanded
        interrupted={false}
        items={[
          {
            seq: 0,
            at_version: 2,
            kind: 'challenge',
            payload: {
              title: 'High-impact rules',
              body: 'Review these rules before applying.',
              tone: 'warning',
            },
          },
          {
            seq: 1,
            at_version: 2,
            kind: 'change_set',
            payload: {
              count: 1,
              changes: ['Update answer configuration'],
              scope: 'configuration',
              full_diff_open: true,
            },
          },
          {
            seq: 2,
            at_version: 2,
            kind: 'checkpoint',
            payload: {
              checkpoint_id: 'checkpoint-1',
              label: 'Pre-edit checkpoint',
              created_at: '2026-09-04T00:00:00Z',
            },
          },
          {
            seq: 3,
            at_version: 2,
            kind: 'assistant_turn',
            payload: {
              turn_id: 'turn-1',
              stage_id: 'edit.impact_analysis',
              execution: { status: 'completed', activities: [] },
              reply_text: 'The change is ready for review.',
              cards: ['challenge', 'change_set', 'checkpoint'],
            },
          },
        ]}
        onActionPayloadChange={vi.fn()}
      />,
    )

    expect(screen.getByText('The change is ready for review.')).toBeInTheDocument()
    expect(screen.queryByText('High-impact rules')).not.toBeInTheDocument()
    expect(screen.queryByText('Review these rules before applying.')).not.toBeInTheDocument()
    expect(screen.queryByText('configuration')).not.toBeInTheDocument()
    expect(screen.queryByText('Update answer configuration')).not.toBeInTheDocument()
    expect(screen.queryByText('Pre-edit checkpoint')).not.toBeInTheDocument()
  })

  it('does not render a Thinking section for execution progress alone', () => {
    const store = createStore()
    store.set(difyBuilderExecutionProgressAtom, {
      sessionId: 'session-1',
      operationId: 'operation-1',
      stageId: 'build.test',
      atVersion: 2,
      revision: 1,
      execution: {
        status: 'running',
        activities: [
          {
            id: 'build-run-test',
            label: 'Run the workflow',
            state: 'active',
          },
        ],
      },
    })

    render(
      <Provider store={store}>
        <DifyBuilderConversation
          busy
          activeInteraction={null}
          changesExpanded={false}
          interrupted={false}
          items={[]}
          onActionPayloadChange={vi.fn()}
        />
      </Provider>,
    )

    expect(screen.getByRole('status')).toHaveTextContent('Run the workflow')
    expect(screen.queryByText(/Thinking|Thought/)).not.toBeInTheDocument()
  })

  it('keeps execution details collapsed by default and preserves user disclosure while snapshots update', async () => {
    const user = userEvent.setup()
    const store = createStore()
    store.set(difyBuilderExecutionProgressAtom, {
      sessionId: 'session-1',
      operationId: 'operation-1',
      stageId: 'build.test',
      atVersion: 2,
      revision: 1,
      execution: {
        status: 'running',
        activities: [
          {
            id: 'build-run-test',
            label: 'Run the workflow',
            state: 'active',
          },
        ],
      },
    })

    render(
      <Provider store={store}>
        <DifyBuilderConversation
          busy
          activeInteraction={null}
          changesExpanded={false}
          interrupted={false}
          items={[]}
          onActionPayloadChange={vi.fn()}
        />
      </Provider>,
    )

    const progressDetails = screen.getByRole('group', { name: 'Run the workflow' })
    const progressToggle = progressDetails.querySelector('summary')
    expect(progressToggle).not.toBeNull()
    expect(progressDetails).not.toHaveAttribute('open')
    expect(screen.getByRole('status')).toHaveTextContent('Run the workflow')
    await user.click(progressToggle!)
    expect(progressDetails).toHaveAttribute('open')

    act(() => {
      store.set(difyBuilderExecutionProgressAtom, {
        sessionId: 'session-1',
        operationId: 'operation-1',
        stageId: 'build.test',
        atVersion: 2,
        revision: 2,
        execution: {
          status: 'running',
          activities: [
            {
              id: 'build-run-test',
              label: 'Run the workflow',
              state: 'done',
            },
            {
              id: 'node:answer',
              label: 'Generate answer',
              state: 'active',
              kind: 'node',
              parent_id: 'build-run-test',
            },
          ],
        },
      })
    })

    expect(screen.getByRole('group', { name: 'Generate answer' })).toBe(progressDetails)
    expect(progressDetails).toHaveAttribute('open')
  })

  it('renders known plan metadata without inferring a status', () => {
    render(
      <DifyBuilderConversation
        busy={false}
        activeInteraction={null}
        changesExpanded={false}
        interrupted={false}
        items={[
          {
            seq: 0,
            at_version: 2,
            kind: 'plan',
            payload: {
              title: 'Build a support workflow',
              subtitle: 'Three steps',
              version_tag: 'v2',
              items: ['Collect the question', 'Generate an answer'],
            },
          },
        ]}
        onActionPayloadChange={vi.fn()}
      />,
    )

    const heading = screen.getByRole('heading', { level: 3, name: 'Build a support workflow' })
    const card = heading.closest('article')
    expect(card).toHaveTextContent('workflow.difyBuilder.cardCategory.plan')
    expect(card).toHaveTextContent('Three steps')
    expect(card).toHaveTextContent('v2')
    expect(card).toHaveTextContent('Collect the question')
    expect(card?.querySelector('[data-card-status]')).not.toBeInTheDocument()
  })

  it('renders failed test result content in the card framework', () => {
    render(
      <DifyBuilderConversation
        busy={false}
        activeInteraction={null}
        changesExpanded={false}
        interrupted={false}
        items={[
          {
            seq: 0,
            at_version: 2,
            kind: 'test_result',
            payload: {
              tone: 'error',
              title: 'Validation failed',
              subtitle: 'One node returned an error.',
            },
          },
        ]}
        onActionPayloadChange={vi.fn()}
      />,
    )

    const heading = screen.getByRole('heading', { level: 3, name: 'Validation failed' })
    const card = heading.closest('article')
    expect(card).toHaveTextContent('workflow.difyBuilder.cardCategory.test')
    expect(card).toHaveTextContent('One node returned an error.')
    expect(card).toHaveTextContent('common.api.actionFailed')
    expect(card?.querySelector('[data-card-status="failed"]')).toBeInTheDocument()
  })
})
