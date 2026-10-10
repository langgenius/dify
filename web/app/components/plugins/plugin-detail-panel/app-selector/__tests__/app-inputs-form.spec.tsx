import type { ComponentProps } from 'react'
import type { FileUploaderInAttachmentWrapperProps } from '@/app/components/base/file-uploader/file-uploader-in-attachment'
import type { fileUpload } from '@/app/components/base/file-uploader/utils'
import { zAppAgentModePayload } from '@dify/contracts/api/console/apps/zod.gen'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { useFile } from '@/app/components/base/file-uploader/hooks'
import { FileContextProvider, useStore } from '@/app/components/base/file-uploader/store'
import { InputVarType } from '@/app/components/workflow/types'
import AppInputsForm from '../app-inputs-form'

const mockFileUpload = vi.hoisted(() => vi.fn<typeof fileUpload>())

vi.mock('@/next/navigation', () => ({
  useParams: () => ({}),
  usePathname: () => '/app/agent-app/configuration',
}))

vi.mock('@/app/components/base/file-uploader/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/components/base/file-uploader/utils')>()),
  fileUpload: mockFileUpload,
}))

vi.mock('uuid', () => ({ v4: () => 'file-1' }))

function UploadControls({ fileConfig }: Pick<FileUploaderInAttachmentWrapperProps, 'fileConfig'>) {
  const files = useStore((state) => state.files)
  const { handleLocalFileUpload, handleClearFiles, handleReUploadFile } = useFile(fileConfig)
  return (
    <div>
      <span data-testid="file-uploader-value">{JSON.stringify(files)}</span>
      <button
        data-testid="file-uploader"
        onClick={() => handleLocalFileUpload(new File(['png'], 'demo.png', { type: 'image/png' }))}
      >
        Upload
      </button>
      <button data-testid="file-uploader-empty" onClick={handleClearFiles}>
        Upload Empty
      </button>
      {files
        .filter((file) => file.progress === -1)
        .map((file) => (
          <button key={file.id} onClick={() => handleReUploadFile(file.id)}>
            Retry {file.name}
          </button>
        ))}
    </div>
  )
}

vi.mock('@/app/components/base/file-uploader', () => ({
  FileUploaderInAttachmentWrapper: ({
    onChange,
    value,
    fileConfig,
  }: FileUploaderInAttachmentWrapperProps) => (
    <FileContextProvider value={value} onChange={onChange}>
      <UploadControls fileConfig={fileConfig} />
    </FileContextProvider>
  ),
}))

type AppInputsFormProps = ComponentProps<typeof AppInputsForm>

const parseAgentToolInputs = (inputs: Record<string, unknown> | undefined) =>
  zAppAgentModePayload.parse({
    enabled: true,
    strategy: 'react',
    max_iteration: 5,
    tools: [
      {
        enabled: true,
        provider_type: 'builtin',
        provider_id: 'test/provider',
        tool_name: 'call_app',
        tool_parameters: {
          target_app: {
            app_id: 'nested-app',
            type: 'app-selector',
            inputs,
            files: [],
          },
        },
      },
    ],
  })

const renderControlledForm = ({
  inputsForms,
  initialInputs,
  onFormChange,
}: {
  inputsForms: AppInputsFormProps['inputsForms']
  initialInputs: AppInputsFormProps['inputs']
  onFormChange: AppInputsFormProps['onFormChange']
}) => {
  const Wrapper = () => {
    const [inputs, setInputs] = useState(initialInputs)
    const [open, setOpen] = useState(true)
    const inputsRef = useRef(initialInputs)

    const handleFormChange = (nextInputs: Record<string, unknown>) => {
      inputsRef.current = nextInputs
      setInputs(nextInputs)
      onFormChange(nextInputs)
    }

    return (
      <>
        <button onClick={() => setOpen(!open)}>{open ? 'Close inputs' : 'Open inputs'}</button>
        {open && (
          <AppInputsForm
            inputsForms={inputsForms}
            inputs={inputs}
            inputsRef={inputsRef}
            onFormChange={handleFormChange}
          />
        )}
      </>
    )
  }

  return render(<Wrapper />)
}

describe('AppInputsForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFileUpload.mockImplementation(({ onSuccessCallback }) =>
      onSuccessCallback({
        id: 'uploaded-file-1',
        name: 'demo.png',
        size: 3,
        mime_type: 'image/png',
        extension: 'png',
        created_at: 1,
        created_by: 'account-1',
        preview_url: null,
        source_url: '',
      }),
    )
  })

  it('should return null when no form items are provided', () => {
    const { container } = render(
      <AppInputsForm
        inputsForms={[]}
        inputs={{}}
        inputsRef={{ current: {} }}
        onFormChange={vi.fn()}
      />,
    )

    expect(container.firstChild).toBeNull()
  })

  it('should update text input values', async () => {
    const user = userEvent.setup()
    const onFormChange = vi.fn()

    renderControlledForm({
      inputsForms: [
        {
          variable: 'question',
          label: 'Question',
          type: InputVarType.textInput,
          required: false,
        },
      ],
      initialInputs: { question: '' },
      onFormChange,
    })

    await user.type(screen.getByRole('textbox', { name: 'Question' }), 'hello')

    expect(onFormChange).toHaveBeenCalledWith({ question: 'hello' })
  })

  it('should update number input values', async () => {
    const user = userEvent.setup()
    const onFormChange = vi.fn()

    renderControlledForm({
      inputsForms: [
        { variable: 'count', label: 'Count', type: InputVarType.number, required: false },
      ],
      initialInputs: { count: '' },
      onFormChange,
    })

    await user.type(screen.getByRole('spinbutton', { name: 'Count' }), '42')

    expect(onFormChange).toHaveBeenCalledWith({ count: '42' })
  })

  it('should update select values', async () => {
    const user = userEvent.setup()
    const onFormChange = vi.fn()
    const inputsRef = { current: { tone: '' } }

    render(
      <AppInputsForm
        inputsForms={[
          {
            variable: 'tone',
            label: 'Tone',
            type: InputVarType.select,
            options: ['friendly', 'formal'],
            required: false,
          },
        ]}
        inputs={{ tone: '' }}
        inputsRef={inputsRef}
        onFormChange={onFormChange}
      />,
    )

    await user.click(screen.getByRole('combobox', { name: 'Tone' }))
    await user.click(await screen.findByRole('option', { name: 'formal' }))

    expect(onFormChange).toHaveBeenCalledWith({ tone: 'formal' })
  })

  it.each([InputVarType.singleFile, InputVarType.multiFiles])(
    'should publish uploaded %s metadata without retaining the local File object',
    async (type) => {
      const user = userEvent.setup()
      const onFormChange = vi.fn<(value: Record<string, unknown>) => void>()

      renderControlledForm({
        inputsForms: [
          {
            variable: 'attachment',
            label: 'Attachment',
            type,
            required: false,
            allowed_file_types: ['image'],
            allowed_file_extensions: ['.png'],
            allowed_file_upload_methods: ['local_file'],
          },
        ],
        initialInputs: {},
        onFormChange,
      })

      await user.click(screen.getByRole('button', { name: 'Upload' }))
      await waitFor(() =>
        expect(screen.getByTestId('file-uploader-value')).toHaveTextContent('uploaded-file-1'),
      )

      const selectedInputs = onFormChange.mock.lastCall?.[0]
      expect(() => parseAgentToolInputs(selectedInputs)).not.toThrow()
      const persistedFile = {
        id: 'file-1',
        name: 'demo.png',
        size: 3,
        type: 'image/png',
        progress: 100,
        transferMethod: 'local_file',
        supportFileType: 'image',
        uploadedId: 'uploaded-file-1',
        base64Url: 'data:image/png;base64,cG5n',
      }
      expect(selectedInputs).toEqual({
        attachment: type === InputVarType.singleFile ? persistedFile : [persistedFile],
      })
      expect(screen.getByTestId('file-uploader-value')).toHaveTextContent('uploaded-file-1')
    },
  )

  it('should retain failed uploads across reopening until retry succeeds', async () => {
    const user = userEvent.setup()
    const onFormChange = vi.fn<(value: Record<string, unknown>) => void>()
    mockFileUpload.mockImplementationOnce(({ onErrorCallback }) =>
      onErrorCallback(new Error('Upload failed')),
    )
    renderControlledForm({
      inputsForms: [
        {
          variable: 'attachment',
          label: 'Attachment',
          type: InputVarType.singleFile,
          required: false,
          allowed_file_types: ['image'],
          allowed_file_upload_methods: ['local_file'],
        },
      ],
      initialInputs: {},
      onFormChange,
    })

    await user.click(screen.getByRole('button', { name: 'Upload' }))
    await screen.findByRole('button', { name: 'Retry demo.png' })
    const originalFile = mockFileUpload.mock.calls[0]?.[0].file
    expect(() => parseAgentToolInputs(onFormChange.mock.lastCall?.[0])).toThrow()

    await user.click(screen.getByRole('button', { name: 'Close inputs' }))
    expect(screen.queryByRole('button', { name: 'Retry demo.png' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Open inputs' }))
    await user.click(screen.getByRole('button', { name: 'Retry demo.png' }))

    expect(mockFileUpload.mock.lastCall?.[0].file).toBe(originalFile)
    expect(screen.queryByRole('button', { name: 'Retry demo.png' })).not.toBeInTheDocument()
    expect(() => parseAgentToolInputs(onFormChange.mock.lastCall?.[0])).not.toThrow()
  })

  it('should update paragraph fields and preserve sibling input values', async () => {
    const user = userEvent.setup()
    const onFormChange = vi.fn()

    renderControlledForm({
      inputsForms: [
        {
          variable: 'description',
          label: 'Description',
          type: InputVarType.paragraph,
          required: false,
        },
      ],
      initialInputs: { description: '', topic: 'existing' },
      onFormChange,
    })

    await user.type(screen.getByRole('textbox', { name: 'Description' }), 'updated paragraph')

    expect(onFormChange).toHaveBeenCalledWith({
      description: 'updated paragraph',
      topic: 'existing',
    })
  })

  it('should keep multi-file values and forward empty multi-file uploads', () => {
    const onFormChange = vi.fn()
    const existingFiles = [{ id: 'existing-file', name: 'existing.png' }]

    render(
      <AppInputsForm
        inputsForms={[
          {
            variable: 'files',
            label: 'Files',
            type: InputVarType.multiFiles,
            required: true,
            max_length: 3,
            allowed_file_types: ['image'],
            allowed_file_extensions: ['.png'],
            allowed_file_upload_methods: ['local_file'],
          },
        ]}
        inputs={{ files: existingFiles }}
        inputsRef={{ current: { files: existingFiles } }}
        onFormChange={onFormChange}
      />,
    )

    expect(screen.getByTestId('file-uploader-value')).toHaveTextContent('"existing-file"')
    expect(screen.queryByText('workflow.panel.optional')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('file-uploader-empty'))
    expect(onFormChange).toHaveBeenCalledWith({ files: [] })
  })

  it('should remove cleared single-file inputs while keeping agent tool parameters publishable', async () => {
    const user = userEvent.setup()
    const onFormChange = vi.fn<(value: Record<string, unknown>) => void>()
    const existingFile = { id: 'existing-file', name: 'existing.png' }
    const siblingInputs = { enabled: false, count: 0, note: '', nullable: null }

    renderControlledForm({
      inputsForms: [
        {
          variable: 'attachment',
          label: 'Attachment',
          type: InputVarType.singleFile,
          required: false,
          allowed_file_types: ['image'],
          allowed_file_extensions: ['.png'],
          allowed_file_upload_methods: ['local_file'],
        },
      ],
      initialInputs: { ...siblingInputs, attachment: existingFile },
      onFormChange,
    })

    expect(screen.getByTestId('file-uploader-value')).toHaveTextContent('"existing-file"')

    await user.click(screen.getByRole('button', { name: 'Upload Empty' }))

    expect(() => parseAgentToolInputs(onFormChange.mock.lastCall?.[0])).not.toThrow()
    expect(onFormChange).toHaveBeenLastCalledWith(siblingInputs)
    expect(onFormChange.mock.lastCall?.[0]).not.toHaveProperty('attachment')
    expect(screen.getByTestId('file-uploader-value')).toHaveTextContent('[]')
  })
})
