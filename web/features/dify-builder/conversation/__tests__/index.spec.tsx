import type { ConversationItem, FormField } from '../../types'
import type { FileUpload } from '@/app/components/base/features/types'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { MarkdownProps } from '@/app/components/base/markdown'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider } from 'jotai'
import { DifyBuilderConversation } from '..'
import { InteractionForm } from '../../interactions/form/form'
import { ResourcePicker } from '../../interactions/resource/picker'
import { difyBuilderExecutionProgressAtom, difyBuilderStreamingTurnAtom } from '../../session/state'

const mocks = vi.hoisted(() => ({
  fileUploader: vi.fn<(config: FileUpload, onChange: (files: FileEntity[]) => void) => void>(),
  markdown: vi.fn(),
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
  Markdown: (props: MarkdownProps) => {
    mocks.markdown(props)
    return <p>{props.content}</p>
  },
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
    mocks.fileUploader(fileConfig, onChange)
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
  variant: 'testdata' | 'build_requirements' | 'edit_rules' = 'testdata',
) => {
  const card: Extract<ConversationItem, { kind: 'form' }> = {
    seq: 0,
    at_version: 1,
    kind: 'form',
    payload: { variant, fields, values },
  }
  render(
    <InteractionForm
      item={card}
      busy={false}
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

  it.each([
    { variant: 'build_requirements', actionId: 'submit_requirements' },
    { variant: 'edit_rules', actionId: 'submit_edit_rules' },
    { variant: 'testdata', actionId: 'provide_testdata' },
  ] as const)(
    'submits cleared fields with the $variant payload semantics',
    async ({ variant, actionId }) => {
      const user = userEvent.setup()
      const { onActionPayloadChange, onActionValidityChange } = renderForm(
        [
          { key: 'audience', label: 'Audience', type: 'text' },
          { key: 'locale', label: 'Locale', type: 'select', options: ['en', 'zh'] },
          { key: 'budget', label: 'Budget', type: 'number' },
          { key: 'settings', label: 'Settings', type: 'json_object' },
          { key: 'retries', label: 'Retries', type: 'number' },
          { key: 'enabled', label: 'Enabled', type: 'checkbox' },
        ],
        {
          audience: 'Managers',
          locale: 'en',
          budget: 100,
          settings: { format: 'report' },
          retries: 0,
          enabled: false,
        },
        vi.fn(),
        vi.fn(),
        variant,
      )

      await user.clear(screen.getByRole('textbox', { name: 'Audience' }))
      await user.click(screen.getByRole('combobox', { name: 'Locale' }))
      await user.click(screen.getByRole('option', { name: 'common.operation.clear' }))
      await user.clear(screen.getByRole('spinbutton', { name: 'Budget' }))
      await user.clear(screen.getByRole('textbox', { name: 'Settings' }))

      await waitFor(() => {
        expect(onActionPayloadChange).toHaveBeenLastCalledWith(
          actionId,
          variant === 'testdata'
            ? { mode: 'provide', inputs: { retries: 0, enabled: false } }
            : {
                audience: null,
                locale: null,
                budget: null,
                settings: null,
                retries: 0,
                enabled: false,
              },
        )
      })
      expect(onActionValidityChange).toHaveBeenLastCalledWith(actionId, true)
    },
  )

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
    expect(query).toHaveValue('')

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
    expect(alert).toHaveTextContent('difyBuilder.validation.invalidJson')
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

  it('merges concurrent upload completions with the latest text input', async () => {
    const user = userEvent.setup()
    const { onActionPayloadChange } = renderForm([
      { key: 'topic', label: 'Topic', type: 'text' },
      { key: 'first', label: 'First document', type: 'file' },
      { key: 'second', label: 'Second document', type: 'file' },
    ])
    const completeFirst = mocks.fileUploader.mock.calls[0]![1]
    const completeSecond = mocks.fileUploader.mock.calls[1]![1]
    const uploadedFile: FileEntity = {
      id: 'upload-first',
      name: 'first.pdf',
      size: 512,
      type: 'application/pdf',
      progress: 100,
      transferMethod: 'local_file',
      supportFileType: 'document',
      uploadedId: 'upload-first',
    }
    await user.type(screen.getByRole('textbox', { name: 'Topic' }), 'Keep this input')

    // Two independent network completions can arrive in the same React batch.
    act(() => {
      completeFirst([uploadedFile])
      completeSecond([{ ...uploadedFile, id: 'upload-second', uploadedId: 'upload-second' }])
    })

    expect(onActionPayloadChange).toHaveBeenLastCalledWith('provide_testdata', {
      mode: 'provide',
      inputs: {
        topic: 'Keep this input',
        first: {
          type: 'document',
          transfer_method: 'local_file',
          url: '',
          upload_file_id: 'upload-first',
        },
        second: {
          type: 'document',
          transfer_method: 'local_file',
          url: '',
          upload_file_id: 'upload-second',
        },
      },
    })
    expect(screen.getByRole('textbox', { name: 'Topic' })).toHaveValue('Keep this input')
  })

  it('announces committed messages as a labelled log without putting streaming tokens in it', () => {
    const store = createStore()
    store.set(difyBuilderStreamingTurnAtom, {
      sessionId: 'session-1',
      commandId: 'command-1',
      operationId: 'operation-1',
      turnId: 'turn-streaming',
      sequence: 1,
      atVersion: 2,
      revision: 1,
      textBytes: 15,
      replyText: 'Streaming reply',
    })

    render(
      <Provider store={store}>
        <DifyBuilderConversation
          busy
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
        />
      </Provider>,
    )

    const log = screen.getByRole('log', { name: 'difyBuilder.panelTitle' })
    expect(log).toHaveAttribute('aria-live', 'polite')
    expect(log).toHaveAttribute('aria-relevant', 'additions')
    expect(within(log).getByRole('heading', { name: 'common.you' })).toBeInTheDocument()
    expect(within(log).getByRole('heading', { name: 'difyBuilder.panelTitle' })).toBeInTheDocument()
    expect(log).toContainElement(screen.getByText('The plan is ready.'))
    expect(log).not.toContainElement(screen.getByText('Streaming reply'))
    expect(mocks.markdown).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Streaming reply', mode: 'streaming' }),
    )
  })

  it.each([
    ['ready', 'difyBuilder.resourceReady'],
    ['missing_config', 'difyBuilder.resourceNeedsAuthorization'],
    ['waiting_setup', 'difyBuilder.resourceNeedsSetup'],
    ['missing_plugin', 'difyBuilder.resourceNeedsSetup'],
    ['placeholder', 'difyBuilder.resourceNeedsSetup'],
  ] as const)(
    'shows %s readiness and submits resource IDs without a conflict policy',
    async (readiness, readinessLabel) => {
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
              kind: 'knowledge',
              label: 'Support knowledge base',
              meta: '12 documents',
              readiness,
            },
          ],
        },
      }

      render(
        <ResourcePicker
          item={resourceCard}
          busy={false}
          onActionPayloadChange={onActionPayloadChange}
        />,
      )

      const checkbox = screen.getByRole('checkbox', { name: 'Support knowledge base' })
      expect(checkbox).toBeChecked()
      expect(checkbox).toHaveAccessibleDescription(`12 documents · ${readinessLabel}`)
      expect(checkbox).toBeEnabled()
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument()

      await user.click(screen.getByText('Support knowledge base'))

      expect(checkbox).not.toBeChecked()
      expect(onActionPayloadChange).toHaveBeenLastCalledWith('confirm_resources', {
        resource_ids: [],
      })

      await user.click(checkbox)

      expect(checkbox).toBeChecked()
      expect(onActionPayloadChange).toHaveBeenLastCalledWith('confirm_resources', {
        resource_ids: ['knowledge-base-1'],
      })
    },
  )

  it('hides source forms and renders the submitted values in read-only controls', () => {
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
    render(
      <DifyBuilderConversation
        busy={false}
        interrupted={false}
        items={[
          oldCard,
          activeCard,
          {
            seq: 9,
            at_version: 6,
            kind: 'interaction_response',
            payload: {
              interaction_kind: 'form',
              question: 'Provide test data',
              fields: [
                {
                  key: 'topic',
                  label: 'Topic',
                  value: 'new value',
                  display_value: 'new value',
                },
              ],
              submitted_data: { topic: 'new value' },
            },
          },
        ]}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Provide test data' })).toBeInTheDocument()
    const topic = screen.getByRole('textbox', { name: 'Topic' })
    expect(topic).toHaveValue('new value')
    expect(topic).toHaveAttribute('readonly')
    expect(screen.queryByDisplayValue('old value')).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('restored value')).not.toBeInTheDocument()
  })

  it('replaces a read-only optimistic form with the durable submitted values', () => {
    const form: Extract<ConversationItem, { kind: 'form' }> = {
      seq: 0,
      at_version: 1,
      kind: 'form',
      payload: {
        variant: 'testdata',
        title: 'Provide test data',
        fields: [{ key: 'topic', label: 'Topic', type: 'text' }],
        values: {},
      },
    }
    const localResponse: Extract<ConversationItem, { kind: 'interaction_response' }> = {
      seq: 1,
      at_version: 2,
      kind: 'interaction_response',
      payload: {
        interaction_kind: 'form',
        question: 'Provide test data',
        fields: [{ key: 'topic', label: 'Topic', value: 'draft', display_value: 'draft' }],
        submitted_data: { topic: 'draft' },
      },
    }
    const localInteractionResponse = {
      afterSequence: 0,
      baseVersion: 1,
      item: localResponse,
      localId: 'local-response-1',
      sessionId: 'session-1',
    }
    const { rerender } = render(
      <DifyBuilderConversation
        busy
        interrupted={false}
        items={[form]}
        localInteractionResponse={localInteractionResponse}
      />,
    )

    expect(screen.getByRole('textbox', { name: 'Topic' })).toHaveValue('draft')
    expect(screen.getByRole('textbox', { name: 'Topic' })).toHaveAttribute('readonly')

    const durableResponse: Extract<ConversationItem, { kind: 'interaction_response' }> = {
      ...localResponse,
      payload: {
        ...localResponse.payload,
        fields: [{ key: 'topic', label: 'Topic', value: 'saved', display_value: 'saved' }],
        submitted_data: { topic: 'saved' },
      },
    }
    rerender(
      <DifyBuilderConversation
        busy={false}
        interrupted={false}
        items={[form, durableResponse]}
        localInteractionResponse={localInteractionResponse}
      />,
    )

    expect(screen.getAllByRole('textbox', { name: 'Topic' })).toHaveLength(1)
    expect(screen.getByRole('textbox', { name: 'Topic' })).toHaveValue('saved')
  })

  it('keeps execution details collapsed by default and preserves user disclosure while snapshots update', async () => {
    const user = userEvent.setup()
    const store = createStore()
    store.set(difyBuilderExecutionProgressAtom, {
      sessionId: 'session-1',
      operationId: 'operation-1',
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
        <DifyBuilderConversation busy interrupted={false} items={[]} />
      </Provider>,
    )

    const progressDetails = screen.getByRole('group', { name: 'Run the workflow' })
    const progressToggle = progressDetails.querySelector('summary')
    expect(progressToggle).not.toBeNull()
    expect(progressDetails).not.toHaveAttribute('open')
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Run the workflow')
    await user.click(progressToggle!)
    expect(progressDetails).toHaveAttribute('open')
    expect(screen.getAllByRole('listitem')).toHaveLength(1)

    act(() => {
      store.set(difyBuilderExecutionProgressAtom, {
        sessionId: 'session-1',
        operationId: 'operation-1',
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
              parent_id: 'build-run-test',
            },
          ],
        },
      })
    })

    expect(screen.getByRole('group', { name: 'Generate answer' })).toBe(progressDetails)
    expect(progressDetails).toHaveAttribute('open')
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('settles only the original approval progress when the resumed test result arrives', async () => {
    const user = userEvent.setup()
    const paused: Extract<ConversationItem, { kind: 'assistant_turn' }> = {
      seq: 1,
      at_version: 2,
      kind: 'assistant_turn',
      payload: {
        turn_id: 'test-turn',
        stage_id: 'edit.test_affected_paths',
        execution: {
          status: 'stopped',
          activities: [
            { id: 'edit-run-test', label: 'Run affected paths', state: 'stopped', kind: 'stage' },
            {
              id: 'node:agent',
              label: 'Weather query',
              state: 'stopped',
              kind: 'node',
              parent_id: 'edit-run-test',
            },
          ],
        },
      },
    }
    const earlier: ConversationItem = {
      ...paused,
      seq: 0,
      at_version: 1,
      payload: {
        ...paused.payload,
        execution: {
          status: 'stopped',
          activities: [{ id: 'edit-run-test', label: 'Earlier test', state: 'stopped' }],
        },
      },
    }
    const result: ConversationItem = {
      seq: 3,
      at_version: 4,
      kind: 'test_result',
      payload: {
        status: 'succeeded',
        resumed_progress: {
          source_seq: paused.seq,
          execution: {
            status: 'completed',
            activities: [
              ...(paused.payload.execution.activities ?? []).map((activity) => ({
                ...activity,
                state: 'done' as const,
              })),
              {
                id: 'node:output',
                label: 'Output',
                state: 'done',
                kind: 'node',
                parent_id: 'edit-run-test',
              },
            ],
          },
        },
      },
    }
    const approval: ConversationItem = {
      seq: 2,
      at_version: 3,
      kind: 'interaction_response',
      payload: { interaction_kind: 'choice', question: 'Test approval', answer: 'Allow' },
    }
    const { rerender, unmount } = render(
      <DifyBuilderConversation
        busy={false}
        interrupted={false}
        items={[earlier, paused, approval]}
      />,
    )
    const progress = screen.getByRole('group', { name: 'Run affected paths' })
    await user.click(within(progress).getByText('Run affected paths'))

    const settled = [earlier, paused, approval, result]
    rerender(<DifyBuilderConversation busy={false} interrupted={false} items={settled} />)
    expect(screen.getByRole('group', { name: 'Output' })).toBe(progress)
    expect(progress).toHaveAttribute('open')
    expect(within(progress).getByText('Weather query').previousElementSibling).toHaveClass(
      'i-ri-check-line',
    )
    expect(screen.getByRole('group', { name: 'Earlier test' })).toBeInTheDocument()

    unmount()
    render(<DifyBuilderConversation busy={false} interrupted={false} items={settled} />)
    expect(screen.getByRole('group', { name: 'Output' })).toBeInTheDocument()
  })

  it('renders the resulting workflow overview and the actual plan step count', () => {
    render(
      <DifyBuilderConversation
        busy={false}
        interrupted={false}
        items={[
          {
            seq: 0,
            at_version: 2,
            kind: 'plan',
            payload: {
              title: 'Build a support workflow',
              input_summary: 'A support question and its attachments.',
              output_summary: 'An answer with references from the knowledge base.',
              items: ['Collect the question', 'Generate an answer'],
            },
          },
        ]}
      />,
    )

    const card = screen.getByRole('article', { name: 'difyBuilder.cardCategory.plan' })
    expect(
      within(card).getByRole('heading', { level: 3, name: 'Build a support workflow' }),
    ).toBeInTheDocument()
    expect(card).toHaveTextContent('difyBuilder.cardCategory.plan')
    expect(card).not.toHaveTextContent('v1')
    expect(card).toHaveTextContent('Collect the question')
    expect(card).toHaveTextContent('A support question and its attachments.')
    expect(card).toHaveTextContent('An answer with references from the knowledge base.')
    expect(card).toHaveTextContent('difyBuilder.plan.stepCount:{"count":2}')
    expect(card).toHaveTextContent('difyBuilder.plan.ready')
    expect(within(card).getAllByRole('listitem')).toHaveLength(2)
  })

  it('shows escaped final outputs and review scope without execution IDs', () => {
    render(
      <DifyBuilderConversation
        busy={false}
        interrupted={false}
        items={[
          {
            kind: 'test_result',
            seq: 0,
            at_version: 2,
            payload: {
              status: 'succeeded',
              outcome: 'execution_succeeded_needs_review',
              dify_run_id: 'run-modern',
              terminal_outputs: {
                missing: null,
                enabled: false,
                count: 0,
                text: '',
                items: [],
                mapping: {},
                html: '<script>alert(1)</script>',
              },
              executed_node_ids: ['start-1', 'end-1'],
              review_note: 'Inspect the answer against the requested goal.',
            },
          },
        ]}
      />,
    )
    const card = screen.getByRole('article', { name: 'difyBuilder.cardCategory.test' })
    expect(card).toHaveTextContent('difyBuilder.testResult.statusPassed')
    const outputs = within(card).getByRole('region', {
      name: 'difyBuilder.testResult.terminalOutputs',
    })
    for (const value of ['null', 'false', '0', '\"\"', '[]', '{}', '<script>alert(1)</script>'])
      expect(within(outputs).getByText(value, { exact: true })).toBeInTheDocument()
    expect(card.querySelector('script')).toBeNull()
    expect(within(card).getByText('Inspect the answer against the requested goal.')).toBeVisible()
    for (const removed of [
      'difyBuilder.testResult.executionSucceeded',
      'difyBuilder.testResult.terminalOutputs',
      'difyBuilder.testResult.rawOutputs',
      'difyBuilder.testResult.reviewRequired',
      'difyBuilder.testResult.scopeLimit',
      'difyBuilder.testResult.observedNodes',
      'difyBuilder.testResult.runId',
      'start-1',
      'end-1',
      'run-modern',
    ])
      expect(within(card).queryByText(removed)).not.toBeInTheDocument()
  })
})

it('shows server material receipts even for file-only turns without treating them as test input', () => {
  render(
    <DifyBuilderConversation
      busy={false}
      interrupted={false}
      items={[]}
      attachments={[
        {
          id: 'material-1',
          app_id: 'app-1',
          session_id: 'session-1',
          task_id: 'task-1',
          generation: 1,
          seq: 1,
          client_turn_id: 'file-only-turn',
          consumed_version: null,
          status: 'pending',
          test_input_candidate: true,
          attachments: [
            {
              upload_file_id: 'upload-1',
              name: 'rules.txt',
              extension: 'txt',
              size: 20,
              status: 'pending',
            },
            {
              upload_file_id: 'upload-2',
              name: 'bad.pdf',
              extension: 'pdf',
              size: 20,
              status: 'rejected',
            },
          ],
        },
      ]}
    />,
  )
  expect(screen.getByText('rules.txt')).toBeInTheDocument()
  expect(screen.getByText('difyBuilder.attachments.pending')).toBeInTheDocument()
  expect(screen.getByText('bad.pdf')).toBeInTheDocument()
  expect(screen.getByText('difyBuilder.attachments.rejected')).toBeInTheDocument()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})
