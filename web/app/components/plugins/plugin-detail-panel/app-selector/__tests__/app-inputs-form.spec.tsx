import type { ComponentProps } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { InputVarType } from '@/app/components/workflow/types'
import AppInputsForm from '../app-inputs-form'

vi.mock('@/app/components/base/file-uploader', () => ({
  FileUploaderInAttachmentWrapper: ({
    onChange,
    value,
  }: {
    onChange: (files: Array<Record<string, unknown>>) => void
    value: Array<Record<string, unknown>>
  }) => (
    <div>
      <span data-testid="file-uploader-value">{JSON.stringify(value)}</span>
      <button
        data-testid="file-uploader"
        onClick={() => onChange([{ id: 'file-1', name: 'demo.png' }])}
      >
        Upload
      </button>
      <button data-testid="file-uploader-empty" onClick={() => onChange([])}>
        Upload Empty
      </button>
    </div>
  ),
}))

type AppInputsFormProps = ComponentProps<typeof AppInputsForm>

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
    const inputsRef = useRef(initialInputs)

    const handleFormChange = (nextInputs: Record<string, unknown>) => {
      inputsRef.current = nextInputs
      setInputs(nextInputs)
      onFormChange(nextInputs)
    }

    return (
      <AppInputsForm
        inputsForms={inputsForms}
        inputs={inputs}
        inputsRef={inputsRef}
        onFormChange={handleFormChange}
      />
    )
  }

  return render(<Wrapper />)
}

describe('AppInputsForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('should update uploaded single file values', () => {
    const onFormChange = vi.fn()
    const inputsRef = { current: { attachment: null } }

    render(
      <AppInputsForm
        inputsForms={[
          {
            variable: 'attachment',
            label: 'Attachment',
            type: InputVarType.singleFile,
            required: false,
            allowed_file_types: [],
            allowed_file_extensions: ['.png'],
            allowed_file_upload_methods: ['local_file'],
          },
        ]}
        inputs={{ attachment: null }}
        inputsRef={inputsRef}
        onFormChange={onFormChange}
      />,
    )

    fireEvent.click(screen.getByTestId('file-uploader'))

    expect(onFormChange).toHaveBeenCalledWith({
      attachment: { id: 'file-1', name: 'demo.png' },
    })
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

  it('should preserve existing single-file values and forward empty single-file uploads as undefined', () => {
    const onFormChange = vi.fn()
    const existingFile = { id: 'existing-file', name: 'existing.png' }

    render(
      <AppInputsForm
        inputsForms={[
          {
            variable: 'attachment',
            label: 'Attachment',
            type: InputVarType.singleFile,
            required: false,
            allowed_file_types: ['image'],
            allowed_file_extensions: ['.png'],
            allowed_file_upload_methods: ['local_file'],
          },
        ]}
        inputs={{ attachment: existingFile }}
        inputsRef={{ current: { attachment: existingFile } }}
        onFormChange={onFormChange}
      />,
    )

    expect(screen.getByTestId('file-uploader-value')).toHaveTextContent('"existing-file"')

    fireEvent.click(screen.getByTestId('file-uploader-empty'))
    expect(onFormChange).toHaveBeenCalledWith({ attachment: undefined })
  })
})
