import type { ConversationItem, FormField } from '../types'
import type { FileUpload } from '@/app/components/base/features/types'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { MarkdownProps } from '@/app/components/base/markdown'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider } from 'jotai'
import { DifyBuilderConversation } from '../conversation'
import { FormCard } from '../conversation/form-card'
import { ResourceCard } from '../conversation/resource-card'
import {
  difyBuilderExecutionProgressAtom,
  difyBuilderReasoningAtom,
  difyBuilderStreamingTurnAtom,
} from '../session/state'

const mocks = vi.hoisted(() => ({
  fileUploader: vi.fn(),
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
  variant: 'testdata' | 'build_requirements' | 'edit_rules' = 'testdata',
) => {
  const card: Extract<ConversationItem, { kind: 'form' }> = {
    seq: 0,
    at_version: 1,
    kind: 'form',
    payload: { variant, fields, values },
  }
  render(
    <FormCard
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

  it.each([
    {
      name: 'option outside the available choices',
      field: { key: 'locale', label: 'Locale', type: 'select', options: ['en', 'zh'] },
      value: 'fr',
      message: 'workflow.difyBuilder.validation.invalidOption',
    },
    {
      name: 'text above the field limit',
      field: { key: 'topic', label: 'Topic', type: 'text', max_length: 3 },
      value: 'long',
      message: 'workflow.difyBuilder.validation.maxLength',
    },
    {
      name: 'non-text value in a text field',
      field: { key: 'topic', label: 'Topic', type: 'text' },
      value: 123,
      message: 'workflow.difyBuilder.validation.invalidValue',
    },
    {
      name: 'too many uploaded files',
      field: { key: 'attachments', label: 'Attachments', type: 'file-list', number_limits: 1 },
      value: [
        { type: 'document', transfer_method: 'local_file', upload_file_id: 'file-1' },
        { type: 'document', transfer_method: 'local_file', upload_file_id: 'file-2' },
      ],
      message: 'workflow.difyBuilder.validation.maxFiles',
    },
  ])('uses localized validation for $name', ({ field, value, message }) => {
    renderForm([field as FormField], { [field.key]: value })

    fireEvent.submit(screen.getByRole('form', { name: 'workflow.difyBuilder.cardCategory.form' }))

    expect(screen.getByRole('alert')).toHaveTextContent(message)
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
        <FormCard
          item={card}
          busy={false}
          onActionPayloadChange={vi.fn()}
          onActionValidityChange={vi.fn()}
        />
        <DifyBuilderConversation busy interrupted={false} items={[]} />
      </Provider>,
    )
    const input = screen.getByRole('textbox', { name: 'Topic' })
    await user.type(input, 'AI agents')

    act(() => {
      store.set(difyBuilderExecutionProgressAtom, {
        sessionId: 'session-1',
        operationId: 'operation-1',
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
        atVersion: 2,
        revision: 1,
        text: 'Inspecting the supplied test data.',
      })
      store.set(difyBuilderStreamingTurnAtom, {
        sessionId: 'session-1',
        commandId: 'command-1',
        operationId: 'operation-1',
        turnId: 'turn-1',
        sequence: 1,
        atVersion: 2,
        revision: 1,
        textBytes: 21,
        replyText: 'Checking the workflow',
      })
    })

    expect(input).toHaveValue('AI agents')
    expect(screen.getByRole('status')).toHaveTextContent('Check test inputs')
    const thinking = screen.getByRole('group', { name: /thinking/i })
    expect(screen.queryByText('Inspecting the supplied test data.')).not.toBeInTheDocument()
    await user.click(within(thinking).getByText(/thinking/i))
    expect(screen.getByText('Inspecting the supplied test data.')).toBeInTheDocument()
    expect(screen.getByText('Checking the workflow')).toBeInTheDocument()
    expect(input).toHaveValue('AI agents')
  })

  it('renders live reasoning only after expansion and scrolls only for visible changes', async () => {
    const user = userEvent.setup()
    const store = createStore()
    const onStreamingContentChange = vi.fn()
    render(
      <Provider store={store}>
        <DifyBuilderConversation
          busy
          interrupted={false}
          items={[]}
          onStreamingContentChange={onStreamingContentChange}
        />
      </Provider>,
    )

    act(() => {
      store.set(difyBuilderReasoningAtom, {
        sessionId: 'session-1',
        operationId: 'operation-1',
        atVersion: 2,
        revision: 1,
        text: 'Inspecting ',
      })
    })
    expect(onStreamingContentChange).toHaveBeenCalledTimes(1)
    expect(mocks.markdown).not.toHaveBeenCalled()

    act(() => {
      store.set(difyBuilderReasoningAtom, {
        sessionId: 'session-1',
        operationId: 'operation-1',
        atVersion: 2,
        revision: 2,
        text: 'Inspecting the workflow.',
      })
    })
    expect(onStreamingContentChange).toHaveBeenCalledTimes(1)
    expect(mocks.markdown).not.toHaveBeenCalled()

    const thinking = screen.getByRole('group', { name: /thinking/i })
    await user.click(within(thinking).getByText(/thinking/i))
    expect(screen.getByText('Inspecting the workflow.')).toBeInTheDocument()
    expect(mocks.markdown).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Inspecting the workflow.' }),
    )
    expect(onStreamingContentChange).toHaveBeenCalledTimes(2)

    act(() => {
      store.set(difyBuilderReasoningAtom, {
        sessionId: 'session-1',
        operationId: 'operation-1',
        atVersion: 2,
        revision: 3,
        text: 'Inspecting the workflow and its nodes.',
      })
    })
    expect(screen.getByText('Inspecting the workflow and its nodes.')).toBeInTheDocument()
    expect(onStreamingContentChange).toHaveBeenCalledTimes(3)
  })

  it('renders assistant reply text through the shared Markdown renderer', () => {
    const replyText = '**The plan is ready.**'

    render(
      <DifyBuilderConversation
        busy={false}
        interrupted={false}
        items={[
          {
            seq: 0,
            at_version: 1,
            kind: 'assistant_turn',
            payload: {
              turn_id: 'turn-assistant-1',
              stage_id: 'build.plan',
              execution: { status: 'completed' },
              reply_text: replyText,
            },
          },
        ]}
      />,
    )

    expect(mocks.markdown).toHaveBeenCalledTimes(1)
    expect(mocks.markdown).toHaveBeenCalledWith(expect.objectContaining({ content: replyText }))
  })

  it('renders user and assistant text without message actions', () => {
    render(
      <DifyBuilderConversation
        busy={false}
        interrupted={false}
        items={[
          {
            seq: 0,
            at_version: 1,
            kind: 'user',
            payload: { text: 'Refine the workflow', turn_id: 'turn-1' },
          },
          {
            seq: 1,
            at_version: 2,
            kind: 'assistant_turn',
            payload: {
              turn_id: 'turn-1',
              stage_id: 'build.plan',
              execution: { status: 'completed' },
              reply_text: '**Updated plan**',
            },
          },
        ]}
      />,
    )

    const log = screen.getByRole('log', { name: 'workflow.difyBuilder.panelTitle' })
    expect(within(log).getByText('Refine the workflow')).toBeInTheDocument()
    expect(within(log).getByText('**Updated plan**')).toBeInTheDocument()
    expect(within(log).queryAllByRole('button')).toHaveLength(0)
  })

  it('renders local user text once while the durable message metadata arrives', () => {
    const localUserMessage = {
      afterSequence: -1,
      localId: 'turn-local-1',
      sessionId: 'session-1',
      text: 'Show this immediately',
      turnId: 'turn-local-1',
    }
    const props = {
      busy: true,
      interrupted: false,
    }
    const { rerender } = render(
      <DifyBuilderConversation {...props} items={[]} localUserMessage={localUserMessage} />,
    )

    expect(screen.getByText(localUserMessage.text)).toBeInTheDocument()

    rerender(
      <DifyBuilderConversation
        {...props}
        items={[
          {
            seq: 0,
            at_version: 2,
            kind: 'user',
            payload: { text: localUserMessage.text, turn_id: localUserMessage.turnId },
          },
        ]}
        localUserMessage={localUserMessage}
      />,
    )

    expect(screen.getAllByText(localUserMessage.text)).toHaveLength(1)
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
        <DifyBuilderConversation busy interrupted={false} items={[]} />
      </Provider>,
    )

    expect(screen.getByRole('status')).toHaveTextContent('workflow.common.running')
  })

  it.each([
    ['ready', 'workflow.difyBuilder.resourceReady'],
    ['missing_config', 'workflow.difyBuilder.resourceNeedsAuthorization'],
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
              kind: 'dataset',
              label: 'Support knowledge base',
              meta: '12 documents',
              readiness,
            },
          ],
        },
      }

      render(
        <ResourceCard
          item={resourceCard}
          busy={false}
          onActionPayloadChange={onActionPayloadChange}
        />,
      )

      const checkbox = screen.getByRole('checkbox', { name: 'Support knowledge base' })
      expect(checkbox).toBeChecked()
      expect(checkbox).toHaveAccessibleDescription(`12 documents · ${readinessLabel}`)
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument()

      await user.click(screen.getByText('Support knowledge base'))

      expect(checkbox).not.toBeChecked()
      expect(onActionPayloadChange).toHaveBeenLastCalledWith('confirm_resources', {
        resource_ids: [],
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

  it('uses the source field types for a read-only submitted form', () => {
    render(
      <DifyBuilderConversation
        busy={false}
        interrupted={false}
        items={[
          {
            seq: 1,
            at_version: 1,
            kind: 'form',
            payload: {
              variant: 'testdata',
              title: 'Provide test data',
              fields: [
                { key: 'enabled', label: 'Enabled', type: 'checkbox' },
                { key: 'retries', label: 'Retries', type: 'number' },
                { key: 'notes', label: 'Notes', type: 'textarea' },
                { key: 'locale', label: 'Locale', type: 'select', options: ['en', 'zh'] },
              ],
              values: {},
            },
          },
          {
            seq: 2,
            at_version: 2,
            kind: 'interaction_response',
            payload: {
              interaction_kind: 'form',
              question: 'Provide test data',
              fields: [
                { key: 'enabled', label: 'Enabled', value: true, display_value: 'Yes' },
                { key: 'retries', label: 'Retries', value: 3, display_value: '3' },
                { key: 'notes', label: 'Notes', value: 'line one', display_value: 'line one' },
                { key: 'locale', label: 'Locale', value: 'zh', display_value: 'zh' },
              ],
              submitted_data: { enabled: true, retries: 3, notes: 'line one', locale: 'zh' },
            },
          },
        ]}
      />,
    )

    expect(screen.getByRole('checkbox', { name: 'Enabled' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Enabled' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.queryByText('Yes')).not.toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Retries' })).toHaveValue(3)
    expect(screen.getByRole('spinbutton', { name: 'Retries' })).toHaveAttribute('readonly')
    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue('line one')
    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveAttribute('readonly')
    const locale = screen.getByRole('combobox', { name: 'Locale' })
    expect(locale).toHaveTextContent('zh')
    expect(locale).toHaveAttribute('data-readonly')
  })

  it('shows submitted files as a read-only file list', () => {
    const document = {
      type: 'document',
      transfer_method: 'local_file',
      url: '',
      upload_file_id: 'file-1',
      name: 'spec.pdf',
    }
    const images = [
      { ...document, upload_file_id: 'file-2', name: 'one.png' },
      { ...document, upload_file_id: 'file-3', name: 'two.png' },
    ]
    render(
      <DifyBuilderConversation
        busy={false}
        interrupted={false}
        items={[
          {
            seq: 1,
            at_version: 1,
            kind: 'form',
            payload: {
              variant: 'testdata',
              fields: [
                { key: 'document', label: 'Document', type: 'file' },
                { key: 'images', label: 'Images', type: 'files' },
              ],
              values: {},
            },
          },
          {
            seq: 2,
            at_version: 2,
            kind: 'interaction_response',
            payload: {
              interaction_kind: 'form',
              question: 'Provide files',
              fields: [
                { key: 'document', label: 'Document', value: document, display_value: 'spec.pdf' },
                {
                  key: 'images',
                  label: 'Images',
                  value: images,
                  display_value: 'one.png, two.png',
                },
              ],
              submitted_data: { document, images },
            },
          },
        ]}
      />,
    )

    const documentGroup = screen.getByRole('group', { name: 'Document' })
    const imagesGroup = screen.getByRole('group', { name: 'Images' })
    expect(within(documentGroup).getAllByRole('listitem')).toHaveLength(1)
    expect(within(documentGroup).getByText('spec.pdf')).toBeInTheDocument()
    expect(within(imagesGroup).getAllByRole('listitem')).toHaveLength(2)
    expect(within(imagesGroup).getByText('one.png')).toBeInTheDocument()
    expect(within(imagesGroup).getByText('two.png')).toBeInTheDocument()
    expect(within(documentGroup).queryByRole('button')).not.toBeInTheDocument()
    expect(within(imagesGroup).queryByRole('button')).not.toBeInTheDocument()
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

  it('renders a read-only form when the source form is outside loaded history', () => {
    render(
      <DifyBuilderConversation
        busy={false}
        interrupted={false}
        items={[
          {
            seq: 8,
            at_version: 6,
            kind: 'interaction_response',
            payload: {
              interaction_kind: 'form',
              question: 'Provide test data',
              fields: [
                { key: 'enabled', label: 'Enabled', value: false, display_value: 'No' },
                { key: 'topic', label: 'Topic', value: 'support', display_value: 'support' },
              ],
              submitted_data: { enabled: false, topic: 'support' },
            },
          },
        ]}
      />,
    )

    expect(screen.getByRole('checkbox', { name: 'Enabled' })).not.toBeChecked()
    expect(screen.getByRole('textbox', { name: 'Topic' })).toHaveValue('support')
    expect(screen.getByRole('textbox', { name: 'Topic' })).toHaveAttribute('readonly')
  })

  it('reconciles an optimistic response with its durable conversation item', () => {
    const response: Extract<ConversationItem, { kind: 'interaction_response' }> = {
      seq: 5,
      at_version: 2,
      kind: 'interaction_response',
      payload: {
        interaction_kind: 'choice',
        question: 'Is this workflow plan ready to apply?',
        answer: 'Approve plan',
        submitted_data: { option_id: 'approve_plan' },
      },
    }
    render(
      <DifyBuilderConversation
        busy={false}
        interrupted={false}
        items={[response]}
        localInteractionResponse={{
          afterSequence: 4,
          baseVersion: 1,
          item: response,
          localId: 'local-response-1',
          sessionId: 'session-1',
        }}
      />,
    )

    expect(
      screen.getAllByRole('heading', { name: 'Is this workflow plan ready to apply?' }),
    ).toHaveLength(1)
    expect(screen.getAllByText('Approve plan')).toHaveLength(1)
  })

  it('shows a submitted response before output committed by the same transition', () => {
    render(
      <DifyBuilderConversation
        busy={false}
        interrupted={false}
        items={[
          {
            seq: 0,
            at_version: 2,
            kind: 'assistant_turn',
            payload: {
              turn_id: 'turn-1',
              stage_id: 'fix.await_verify',
              execution: { status: 'completed' },
              reply_text: 'Provide test inputs to continue.',
            },
          },
          {
            seq: 1,
            at_version: 2,
            kind: 'interaction_response',
            payload: {
              interaction_kind: 'choice',
              question: 'What should Builder do with the applied fix?',
              answer: 'Run validation',
              submitted_data: { option_id: 'run_validation' },
            },
          },
        ]}
      />,
    )

    const response = screen.getByRole('heading', {
      name: 'What should Builder do with the applied fix?',
    })
    const assistant = screen.getByText('Provide test inputs to continue.')
    expect(
      response.compareDocumentPosition(assistant) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('keeps completed execution and reasoning available with the committed reply', async () => {
    const user = userEvent.setup()
    render(
      <DifyBuilderConversation
        busy={false}
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
      />,
    )

    expect(screen.getAllByText('Draft the workflow plan')).toHaveLength(1)
    await user.click(screen.getByText('Draft the workflow plan'))
    expect(screen.getAllByText('Draft the workflow plan')).toHaveLength(2)
    expect(
      screen.queryByText('The workflow needs one input and one answer node.'),
    ).not.toBeInTheDocument()
    const thinking = screen.getByRole('group', { name: /thought/i })
    await user.click(within(thinking).getByText(/thought/i))
    expect(
      screen.getByText('The workflow needs one input and one answer node.'),
    ).toBeInTheDocument()
    expect(screen.getByText('The plan is ready.')).toBeInTheDocument()
  })

  it('renders change summaries as ordinary assistant text', () => {
    render(
      <DifyBuilderConversation
        busy={false}
        interrupted={false}
        items={[
          {
            seq: 0,
            at_version: 2,
            kind: 'assistant_turn',
            payload: {
              turn_id: 'turn-1',
              stage_id: 'edit.impact_analysis',
              execution: { status: 'completed', activities: [] },
              reply_text: 'Updated the answer configuration. The change is ready for review.',
            },
          },
        ]}
      />,
    )

    expect(
      screen.getByText('Updated the answer configuration. The change is ready for review.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('workflow.difyBuilder.changes')).not.toBeInTheDocument()
  })

  it('renders preflight findings with Builder-owned checklist styling', () => {
    render(
      <DifyBuilderConversation
        busy={false}
        interrupted={false}
        items={[
          {
            seq: 0,
            at_version: 2,
            kind: 'preflight_context',
            payload: {
              issue_count: 1,
              node_count: 1,
              issues: [
                {
                  node_id: 'answer-1',
                  node_type: 'answer',
                  title: 'Answer',
                  messages: ['Model is required'],
                  unconnected: true,
                  plugin_missing: true,
                },
              ],
            },
          },
        ]}
      />,
    )

    const card = screen.getByRole('article', {
      name: 'workflow.difyBuilder.cardCategory.checks',
    })
    expect(within(card).getByRole('heading', { level: 4, name: 'Answer' })).toBeInTheDocument()
    expect(within(card).getByText('answer')).toBeInTheDocument()
    expect(within(card).getByText('Model is required')).toBeInTheDocument()
    expect(within(card).getByText('workflow.common.needConnectTip')).toBeInTheDocument()
    expect(
      within(card).getByText(/^workflow\.nodes\.common\.pluginsNotInstalled/),
    ).toBeInTheDocument()
  })

  it('does not render a Thinking section for execution progress alone', () => {
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

    expect(screen.getByRole('status')).toHaveTextContent('Run the workflow')
    expect(screen.queryByText(/Thinking|Thought/)).not.toBeInTheDocument()
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

  it('renders a plan title and steps without version metadata', () => {
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
              items: ['Collect the question', 'Generate an answer'],
            },
          },
        ]}
      />,
    )

    const heading = screen.getByRole('heading', { level: 3, name: 'Build a support workflow' })
    const card = heading.closest('article')
    expect(card).toHaveTextContent('workflow.difyBuilder.cardCategory.plan')
    expect(card).not.toHaveTextContent('v1')
    expect(card).toHaveTextContent('Collect the question')
    expect(card?.querySelector('[data-card-status]')).not.toBeInTheDocument()
  })

  it('renders failed test result content in the card framework', () => {
    render(
      <DifyBuilderConversation
        busy={false}
        interrupted={false}
        items={[
          {
            seq: 0,
            at_version: 2,
            kind: 'test_result',
            payload: {
              status: 'failed',
              failure_reason: 'One node returned an error.',
              dify_run_id: 'run-1',
            },
          },
        ]}
      />,
    )

    const heading = screen.getByRole('heading', {
      level: 3,
      name: 'workflow.difyBuilder.testResult.executionFailed',
    })
    const card = heading.closest('article')
    expect(card).toHaveTextContent('workflow.difyBuilder.cardCategory.test')
    expect(card).toHaveTextContent('One node returned an error.')
    expect(card?.querySelector('[data-card-status="failed"]')).toBeInTheDocument()
  })

  it('renders historical success as execution needing review with unavailable evidence', () => {
    render(
      <DifyBuilderConversation
        busy={false}
        interrupted={false}
        items={[
          {
            kind: 'test_result',
            seq: 0,
            at_version: 2,
            payload: { status: 'succeeded', dify_run_id: 'run-1' },
          },
        ]}
      />,
    )

    const heading = screen.getByRole('heading', {
      level: 3,
      name: 'workflow.difyBuilder.testResult.executionSucceeded',
    })
    const card = heading.closest('article')
    expect(card?.querySelector('[data-card-status="done"]')).not.toBeInTheDocument()
    expect(card).toHaveTextContent('run-1')
    expect(card).toHaveTextContent('workflow.difyBuilder.testResult.outputsUnavailable')
    expect(card).toHaveTextContent('workflow.difyBuilder.testResult.reviewRequired')
    expect(card).toHaveTextContent('workflow.difyBuilder.testResult.scopeLimit')
  })

  it('exposes full escaped terminal outputs and observed IDs for review after successful execution', async () => {
    const user = userEvent.setup()
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
    const card = screen.getByRole('article', { name: 'workflow.difyBuilder.cardCategory.test' })
    expect(
      within(card).getByRole('heading', {
        name: 'workflow.difyBuilder.testResult.executionSucceeded',
      }),
    ).toBeInTheDocument()
    expect(card).toHaveTextContent('workflow.difyBuilder.testResult.reviewRequired')
    expect(card).toHaveTextContent('workflow.difyBuilder.testResult.scopeLimit')
    expect(card).toHaveTextContent('Inspect the answer against the requested goal.')
    expect(card.querySelector('[data-card-status="done"]')).not.toBeInTheDocument()
    const outputs = within(card).getByRole('group', {
      name: 'workflow.difyBuilder.testResult.terminalOutputs',
    })
    await user.click(within(outputs).getByText('workflow.difyBuilder.testResult.terminalOutputs'))
    const output = within(outputs).getByText(/"missing": null/)
    expect(output.textContent).toBe(
      '{\n  "missing": null,\n  "enabled": false,\n  "count": 0,\n  "text": "",\n  "items": [],\n  "mapping": {},\n  "html": "<script>alert(1)</script>"\n}',
    )
    expect(output.querySelector('script')).toBeNull()
    const nodes = within(card).getByRole('group', {
      name: 'workflow.difyBuilder.testResult.observedNodes',
    })
    await user.click(within(nodes).getByText('workflow.difyBuilder.testResult.observedNodes'))
    expect(nodes).toHaveTextContent('start-1')
    expect(nodes).toHaveTextContent('end-1')
    expect(card).toHaveTextContent('run-modern')
    expect(within(card).queryByRole('link')).not.toBeInTheDocument()
  })

  it('renders an empty known output mapping as available evidence', () => {
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
              terminal_outputs: {},
              executed_node_ids: [],
            },
          },
        ]}
      />,
    )
    expect(
      screen.getByRole('group', { name: 'workflow.difyBuilder.testResult.terminalOutputs' }),
    ).toHaveTextContent('{}')
    expect(
      screen.getByRole('group', { name: 'workflow.difyBuilder.testResult.observedNodes' }),
    ).toHaveTextContent('[]')
    expect(
      screen.queryByText('workflow.difyBuilder.testResult.outputsUnavailable'),
    ).not.toBeInTheDocument()
  })

  it.each([undefined, null])(
    'marks %s terminal output evidence as unavailable',
    (terminal_outputs) => {
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
                terminal_outputs,
              },
            },
          ]}
        />,
      )
      expect(
        screen.getByText('workflow.difyBuilder.testResult.outputsUnavailable'),
      ).toBeInTheDocument()
      expect(screen.getByText('workflow.difyBuilder.testResult.reviewRequired')).toBeInTheDocument()
      expect(
        screen.queryByRole('group', { name: 'workflow.difyBuilder.testResult.terminalOutputs' }),
      ).not.toBeInTheDocument()
    },
  )

  it.each([
    ['required_output_unresolved', 'succeeded', 'requiredOutputUnresolved'],
    ['execution_unknown', 'succeeded', 'executionUnknown'],
    ['execution_failed', 'succeeded', 'executionFailed'],
  ] as const)('distinguishes %s from compatibility status', (outcome, status, heading) => {
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
              status,
              outcome,
              failure_reason: 'Details for inspection',
              review_note: 'Review this attempt.',
            },
          },
        ]}
      />,
    )
    expect(
      screen.getByRole('heading', { name: `workflow.difyBuilder.testResult.${heading}` }),
    ).toBeInTheDocument()
    expect(screen.getByText('Details for inspection')).toBeInTheDocument()
    expect(screen.getByText('Review this attempt.')).toBeInTheDocument()
    expect(screen.getByText('workflow.difyBuilder.testResult.scopeLimit')).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'workflow.difyBuilder.testResult.executionSucceeded' }),
    ).not.toBeInTheDocument()
  })
})
