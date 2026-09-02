import type { FormField } from '../types'
import type { FileUpload } from '@/app/components/base/features/types'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider } from 'jotai'
import { DifyBuilderConversation } from '../conversation'
import { difyBuilderStreamingTurnAtom } from '../session/state'

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
  render(
    <DifyBuilderConversation
      busy={false}
      changesExpanded={false}
      interrupted={false}
      items={[
        {
          seq: 0,
          at_version: 1,
          kind: 'form',
          payload: { variant: 'testdata', fields, values },
        },
      ]}
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
    render(
      <Provider store={store}>
        <DifyBuilderConversation
          busy={false}
          changesExpanded={false}
          interrupted={false}
          items={[
            {
              seq: 0,
              at_version: 1,
              kind: 'form',
              payload: {
                variant: 'testdata',
                fields: [{ key: 'topic', label: 'Topic', type: 'text-input' }],
                values: {},
              },
            },
          ]}
          onActionPayloadChange={vi.fn()}
          onActionValidityChange={vi.fn()}
        />
      </Provider>,
    )
    const input = screen.getByRole('textbox', { name: 'Topic' })
    await user.type(input, 'AI agents')

    act(() => {
      store.set(difyBuilderStreamingTurnAtom, {
        sessionId: 'session-1',
        turnId: 'turn-1',
        sequence: 1,
        atVersion: 2,
        stageId: 'build.test',
        replyText: 'Checking the workflow',
      })
    })

    expect(input).toHaveValue('AI agents')
    expect(screen.getByText('Checking the workflow')).toBeInTheDocument()
  })
})
