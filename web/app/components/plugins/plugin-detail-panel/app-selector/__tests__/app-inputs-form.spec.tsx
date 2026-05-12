import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
      <button data-testid="file-uploader" onClick={() => onChange([{ id: 'file-1', name: 'demo.png' }])}>
        Upload
      </button>
      <button data-testid="file-uploader-empty" onClick={() => onChange([])}>
        Upload Empty
      </button>
    </div>
  ),
}))

vi.mock('@langgenius/dify-ui/select', async () => {
  const React = await import('react')
  const SelectContext = React.createContext<{
    onValueChange?: (value: string) => void
  }>({})

  return {
    Select: ({ children, onValueChange }: {
      children: React.ReactNode
      onValueChange?: (value: string) => void
    }) => (
      <SelectContext.Provider value={{ onValueChange }}>
        <div>{children}</div>
      </SelectContext.Provider>
    ),
    SelectTrigger: ({ children }: { children: React.ReactNode }) => {
      const context = React.useContext(SelectContext)

      return (
        <div>
          <button type="button">{children}</button>
          <button data-testid="select-empty" type="button" onClick={() => context.onValueChange?.('')}>
            Empty Select
          </button>
        </div>
      )
    },
    SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectItem: ({ children, value }: { children: React.ReactNode, value: string }) => {
      const context = React.useContext(SelectContext)
      return (
        <button key={value} data-testid={`select-${value}`} type="button" onClick={() => context.onValueChange?.(value)}>
          {children}
        </button>
      )
    },
    SelectItemText: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    SelectItemIndicator: () => null,
  }
})

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

  it('should update text input values', () => {
    const onFormChange = vi.fn()
    const inputsRef = { current: { question: '' } }

    render(
      <AppInputsForm
        inputsForms={[{ variable: 'question', label: 'Question', type: InputVarType.textInput, required: false }]}
        inputs={{ question: '' }}
        inputsRef={inputsRef}
        onFormChange={onFormChange}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('Question'), {
      target: { value: 'hello' },
    })

    expect(onFormChange).toHaveBeenCalledWith({ question: 'hello' })
  })

  it('should update number input values', () => {
    const onFormChange = vi.fn()
    const inputsRef = { current: { count: '' } }

    render(
      <AppInputsForm
        inputsForms={[{ variable: 'count', label: 'Count', type: InputVarType.number, required: false }]}
        inputs={{ count: '' }}
        inputsRef={inputsRef}
        onFormChange={onFormChange}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('Count'), {
      target: { value: '42' },
    })

    expect(onFormChange).toHaveBeenCalledWith({ count: '42' })
  })

  it('should update select values', () => {
    const onFormChange = vi.fn()
    const inputsRef = { current: { tone: '' } }

    render(
      <AppInputsForm
        inputsForms={[{ variable: 'tone', label: 'Tone', type: InputVarType.select, options: ['friendly', 'formal'], required: false }]}
        inputs={{ tone: '' }}
        inputsRef={inputsRef}
        onFormChange={onFormChange}
      />,
    )

    fireEvent.click(screen.getByTestId('select-formal'))

    expect(onFormChange).toHaveBeenCalledWith({ tone: 'formal' })
  })

  it('should ignore empty select values and render the placeholder when there is no current selection', () => {
    const onFormChange = vi.fn()
    const inputsRef = { current: { tone: '' } }

    render(
      <AppInputsForm
        inputsForms={[{ variable: 'tone', label: 'Tone', type: InputVarType.select, options: ['friendly', 'formal'], required: false }]}
        inputs={{ tone: '' }}
        inputsRef={inputsRef}
        onFormChange={onFormChange}
      />,
    )

    expect(screen.getAllByText('Tone').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByTestId('select-empty'))

    expect(onFormChange).not.toHaveBeenCalled()
  })

  it('should update uploaded single file values', () => {
    const onFormChange = vi.fn()
    const inputsRef = { current: { attachment: null } }

    render(
      <AppInputsForm
        inputsForms={[{
          variable: 'attachment',
          label: 'Attachment',
          type: InputVarType.singleFile,
          required: false,
          allowed_file_types: [],
          allowed_file_extensions: ['.png'],
          allowed_file_upload_methods: ['local_file'],
        }]}
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

  it('should update paragraph fields and preserve sibling input values', () => {
    const onFormChange = vi.fn()
    const inputsRef = { current: { description: 'old', topic: 'existing' } }

    render(
      <AppInputsForm
        inputsForms={[{ variable: 'description', label: 'Description', type: InputVarType.paragraph, required: false }]}
        inputs={{ description: '' }}
        inputsRef={inputsRef}
        onFormChange={onFormChange}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('Description'), {
      target: { value: 'updated paragraph' },
    })

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
        inputsForms={[{
          variable: 'files',
          label: 'Files',
          type: InputVarType.multiFiles,
          required: true,
          max_length: 3,
          allowed_file_types: ['image'],
          allowed_file_extensions: ['.png'],
          allowed_file_upload_methods: ['local_file'],
        }]}
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
        inputsForms={[{
          variable: 'attachment',
          label: 'Attachment',
          type: InputVarType.singleFile,
          required: false,
          allowed_file_types: ['image'],
          allowed_file_extensions: ['.png'],
          allowed_file_upload_methods: ['local_file'],
        }]}
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
