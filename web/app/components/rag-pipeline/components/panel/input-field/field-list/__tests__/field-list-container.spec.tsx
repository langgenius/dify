import type { InputVar } from '@/models/pipeline'
import { fireEvent, render, screen } from '@testing-library/react'
import { PipelineInputVarType } from '@/models/pipeline'
import FieldListContainer from '../field-list-container'

const createInputVar = (variable: string): InputVar => ({
  type: PipelineInputVarType.textInput,
  label: variable,
  variable,
  max_length: 48,
  default_value: '',
  required: true,
  tooltips: '',
  options: [],
  placeholder: '',
  unit: '',
  allowed_file_upload_methods: [],
  allowed_file_types: [],
  allowed_file_extensions: [],
})

describe('FieldListContainer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the field items inside the sortable container', () => {
    const onListSortChange = vi.fn()
    const { container } = render(
      <FieldListContainer
        inputFields={[createInputVar('field_1'), createInputVar('field_2')]}
        onListSortChange={onListSortChange}
        onRemoveField={vi.fn()}
        onEditField={vi.fn()}
      />,
    )

    expect(screen.getAllByText('field_1').length).toBeGreaterThan(0)
    expect(screen.getAllByText('field_2').length).toBeGreaterThan(0)
    expect(container.querySelector('.handle')).toBeInTheDocument()
    expect(onListSortChange).not.toHaveBeenCalled()
  })

  it('should honor readonly mode for the rendered field rows', () => {
    const { container } = render(
      <FieldListContainer
        readonly
        inputFields={[createInputVar('field_1'), createInputVar('field_2')]}
        onListSortChange={vi.fn()}
        onRemoveField={vi.fn()}
        onEditField={vi.fn()}
      />,
    )

    const firstRow = container.querySelector('.handle')
    fireEvent.mouseEnter(firstRow!)

    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})
