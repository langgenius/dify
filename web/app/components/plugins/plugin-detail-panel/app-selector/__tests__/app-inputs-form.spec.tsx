import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InputVarType } from '@/app/components/workflow/types'
import AppInputsForm from '../app-inputs-form'

vi.mock('@/app/components/base/file-uploader', () => ({
  FileUploaderInAttachmentWrapper: ({
    onChange,
  }: {
    onChange: (files: Array<Record<string, unknown>>) => void
  }) => (
    <button data-testid="file-uploader" onClick={() => onChange([{ id: 'file-1', name: 'demo.png' }])}>
      Upload
    </button>
  ),
}))

vi.mock('@/app/components/base/select', () => ({
  PortalSelect: ({
    items,
    onSelect,
  }: {
    items: Array<{ value: string, name: string }>
    onSelect: (item: { value: string }) => void
  }) => (
    <div>
      {items.map(item => (
        <button key={item.value} data-testid={`select-${item.value}`} onClick={() => onSelect(item)}>
          {item.name}
        </button>
      ))}
    </div>
  ),
}))

describe('AppInputsForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
})
