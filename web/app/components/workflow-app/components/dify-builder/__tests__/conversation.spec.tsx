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

    expect(query).toBeRequired()
    expect(query).toHaveAttribute('maxlength', '5')
    expect(query).toHaveAttribute('placeholder', 'Ask')
    expect(screen.getByRole('combobox', { name: /Locale/ })).toHaveValue('en')
    await waitFor(() => {
      expect(onActionValidityChange).toHaveBeenLastCalledWith('provide_testdata', false)
    })

    await user.type(query, 'hello')

    await waitFor(() => {
      expect(onActionPayloadChange).toHaveBeenLastCalledWith('provide_testdata', {
        mode: 'provide',
        inputs: { locale: 'en', query: 'hello' },
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

  it('preserves the execution disclosure state while snapshots update', async () => {
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
    expect(progressDetails).toHaveAttribute('open')
    await user.click(progressToggle!)
    expect(progressDetails).not.toHaveAttribute('open')

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
    expect(progressDetails).not.toHaveAttribute('open')
  })

  it('renders failed test results with the destructive card tone', () => {
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

    expect(screen.getByText('Validation failed').closest('[data-card-state]')).toHaveClass(
      'border-state-destructive-border',
    )
  })
})
