import type { ComponentProps, ReactNode } from 'react'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { fileUpload } from '@/app/components/base/file-uploader/utils'
import { zAppAgentModePayload } from '@dify/contracts/api/console/apps/zod.gen'
import { render as rtlRender, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { InputVarType } from '@/app/components/workflow/types'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { TransferMethod } from '@/types/app'
import AppInputsForm from '../app-inputs-form'

const render = (ui: ReactNode) => rtlRender(ui, { wrapper: createConsoleQueryWrapper().wrapper })

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

const createUploadedFile = (overrides: Partial<FileEntity> = {}): FileEntity => ({
  id: 'existing-file',
  name: 'existing.png',
  size: 3,
  type: 'image/png',
  progress: 100,
  transferMethod: TransferMethod.local_file,
  supportFileType: 'image',
  uploadedId: 'uploaded-existing-file',
  base64Url: 'data:image/png;base64,cG5n',
  ...overrides,
})

const getFileInput = () => document.querySelector<HTMLInputElement>('input[type="file"]')!
const createLocalFile = () => new File(['png'], 'demo.png', { type: 'image/png' })

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
        <output aria-label="form values">
          {JSON.stringify(inputs, (key, value) =>
            key === 'originalFile' && value instanceof File ? value.name : value,
          )}
        </output>
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

  it.each([
    [InputVarType.textInput, 'textbox', 'hello'],
    [InputVarType.number, 'spinbutton', '42'],
    [InputVarType.paragraph, 'textbox', 'updated paragraph'],
  ] as const)('updates a %s field while preserving sibling inputs', async (type, role, value) => {
    const user = userEvent.setup()
    const onFormChange = vi.fn()
    renderControlledForm({
      inputsForms: [{ variable: 'answer', label: 'Answer', type, required: false }],
      initialInputs: { answer: '', topic: 'existing' },
      onFormChange,
    })
    await user.type(screen.getByRole(role, { name: 'Answer' }), value)
    expect(onFormChange).toHaveBeenLastCalledWith({ answer: value, topic: 'existing' })
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

      await user.upload(getFileInput(), createLocalFile())
      expect(await screen.findByText('demo.png')).toBeInTheDocument()

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
      const expectedInputs = {
        attachment: type === InputVarType.singleFile ? persistedFile : [persistedFile],
      }
      await waitFor(() => expect(onFormChange).toHaveBeenLastCalledWith(expectedInputs))

      const selectedInputs = onFormChange.mock.lastCall![0]
      expect(() => parseAgentToolInputs(selectedInputs)).not.toThrow()
      expect(selectedInputs).toEqual(expectedInputs)
      expect(screen.getByRole('status', { name: 'form values' })).toHaveTextContent(
        'uploaded-file-1',
      )
      await user.click(screen.getByRole('button', { name: 'Close inputs' }))
      await user.click(screen.getByRole('button', { name: 'Open inputs' }))
      expect(screen.getByText('demo.png')).toBeInTheDocument()
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

    await user.upload(getFileInput(), createLocalFile())
    await screen.findByRole('button', { name: 'common.operation.retry demo.png' })
    const originalFile = mockFileUpload.mock.calls[0]?.[0].file
    expect(() => parseAgentToolInputs(onFormChange.mock.lastCall?.[0])).toThrow()

    await user.click(screen.getByRole('button', { name: 'Close inputs' }))
    expect(
      screen.queryByRole('button', { name: 'common.operation.retry demo.png' }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Open inputs' }))
    expect(screen.getByText('demo.png')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.retry demo.png' }))

    expect(mockFileUpload.mock.lastCall?.[0].file).toBe(originalFile)
    expect(
      screen.queryByRole('button', { name: 'common.operation.retry demo.png' }),
    ).not.toBeInTheDocument()
    expect(() => parseAgentToolInputs(onFormChange.mock.lastCall?.[0])).not.toThrow()
    expect(screen.getByRole('status', { name: 'form values' })).toHaveTextContent('uploaded-file-1')
  })

  it('should remove every multi-file value and publish an empty list', async () => {
    const user = userEvent.setup()
    const onFormChange = vi.fn()
    const existingFiles = [
      createUploadedFile(),
      createUploadedFile({
        id: 'remaining-file',
        name: 'remaining.png',
        uploadedId: 'uploaded-remaining-file',
      }),
    ]

    renderControlledForm({
      inputsForms: [
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
      ],
      initialInputs: { files: existingFiles },
      onFormChange,
    })

    expect(screen.getByText('existing.png')).toBeInTheDocument()
    expect(screen.getByText('remaining.png')).toBeInTheDocument()
    expect(screen.queryByText('workflow.panel.optional')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common.operation.remove existing.png' }))
    expect(onFormChange).toHaveBeenLastCalledWith({ files: [existingFiles[1]] })
    expect(screen.queryByText('existing.png')).not.toBeInTheDocument()
    expect(screen.getByText('remaining.png')).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'form values' })).toHaveTextContent(
      'uploaded-remaining-file',
    )

    await user.click(screen.getByRole('button', { name: 'common.operation.remove remaining.png' }))
    expect(onFormChange).toHaveBeenLastCalledWith({ files: [] })
    expect(screen.queryByText('existing.png')).not.toBeInTheDocument()
    expect(screen.queryByText('remaining.png')).not.toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'form values' }).textContent).toBe('{"files":[]}')
  })

  it('should remove cleared single-file inputs while keeping agent tool parameters publishable', async () => {
    const user = userEvent.setup()
    const onFormChange = vi.fn<(value: Record<string, unknown>) => void>()
    const existingFile = createUploadedFile()
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

    expect(screen.getByText('existing.png')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common.operation.remove existing.png' }))

    expect(() => parseAgentToolInputs(onFormChange.mock.lastCall?.[0])).not.toThrow()
    expect(onFormChange).toHaveBeenLastCalledWith(siblingInputs)
    expect(onFormChange.mock.lastCall?.[0]).not.toHaveProperty('attachment')
    expect(screen.queryByText('existing.png')).not.toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'form values' })).not.toHaveTextContent('attachment')
  })
})
