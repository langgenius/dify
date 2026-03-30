import type { FileUploadConfigResponse } from '@/models/common'
import type { VarInInspect } from '@/types/workflow'
import { fireEvent, render, screen } from '@testing-library/react'
import { ToastContext } from '@/app/components/base/toast/context'
import { VarType } from '@/app/components/workflow/types'
import { VarInInspectType } from '@/types/workflow'
import {
  BoolArraySection,
  ErrorMessages,
  FileEditorSection,
  JsonEditorSection,
  TextEditorSection,
} from '../value-content-sections'

vi.mock('@/app/components/workflow/nodes/llm/components/json-schema-config-modal/schema-editor', () => ({
  default: ({ schema, onUpdate }: { schema: string, onUpdate: (value: string) => void }) => (
    <textarea data-testid="schema-editor" value={schema} onChange={event => onUpdate(event.target.value)} />
  ),
}))

vi.mock('@/next/navigation', () => ({
  useParams: () => ({ token: '' }),
}))

describe('value-content sections', () => {
  const createFileUploadConfig = (): FileUploadConfigResponse => ({
    batch_count_limit: 10,
    image_file_batch_limit: 10,
    single_chunk_attachment_limit: 10,
    attachment_image_file_size_limit: 2,
    file_size_limit: 15,
    file_upload_limit: 5,
    workflow_file_upload_limit: 5,
  })

  const createVar = (overrides: Partial<VarInInspect>): VarInInspect => ({
    id: 'var-1',
    name: 'query',
    type: VarInInspectType.node,
    value_type: VarType.string,
    value: '',
    ...overrides,
  } as VarInInspect)

  it('should render the text editor section and forward text changes', () => {
    const handleTextChange = vi.fn()

    render(
      <TextEditorSection
        currentVar={createVar({ value_type: VarType.string })}
        value="hello"
        textEditorDisabled={false}
        isTruncated={false}
        onTextChange={handleTextChange}
      />,
    )

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'updated' } })
    expect(handleTextChange).toHaveBeenCalledWith('updated')
  })

  it('should render the textarea editor for non-string values', () => {
    const handleTextChange = vi.fn()

    render(
      <TextEditorSection
        currentVar={createVar({ name: 'count', value_type: VarType.number })}
        value="12"
        textEditorDisabled={false}
        isTruncated={false}
        onTextChange={handleTextChange}
      />,
    )

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '24' } })
    expect(handleTextChange).toHaveBeenCalledWith('24')
  })

  it('should update a boolean array item by index', () => {
    const onChange = vi.fn()
    render(<BoolArraySection values={[true, false]} onChange={onChange} />)

    fireEvent.click(screen.getAllByText('True')[1])
    expect(onChange).toHaveBeenCalledWith([true, true])
  })

  it('should render schema editor and error messages', () => {
    const onChange = vi.fn()
    render(
      <>
        <JsonEditorSection
          hasChunks={false}
          valueType={VarType.object}
          json="{}"
          readonly={false}
          isTruncated={false}
          onChange={onChange}
        />
        <ErrorMessages
          parseError={new Error('Broken JSON')}
          validationError="Too deep"
        />
      </>,
    )

    fireEvent.change(screen.getByTestId('schema-editor'), { target: { value: '{"foo":1}' } })
    expect(onChange).toHaveBeenCalledWith('{"foo":1}')
    expect(screen.getByText('Broken JSON')).toBeInTheDocument()
    expect(screen.getByText('Too deep')).toBeInTheDocument()
  })

  it('should render chunk preview when the json editor has chunks', () => {
    render(
      <JsonEditorSection
        hasChunks
        schemaType="general_structure"
        valueType={VarType.object}
        json="{}"
        readonly={false}
        isTruncated={false}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByTestId('schema-editor')).toBeInTheDocument()
  })

  it('should render the file editor section', () => {
    render(
      <ToastContext.Provider value={{ notify: vi.fn(), close: vi.fn() }}>
        <FileEditorSection
          currentVar={createVar({ name: 'files', value_type: VarType.file })}
          fileValue={[]}
          fileUploadConfig={createFileUploadConfig()}
          textEditorDisabled={false}
          onChange={vi.fn()}
        />
      </ToastContext.Provider>,
    )

    expect(screen.getAllByRole('button').length).toBeGreaterThan(0)
  })
})
