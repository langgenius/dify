import type { InputVar } from '@/models/pipeline'
import { fireEvent, render, screen } from '@testing-library/react'
import { PipelineInputVarType } from '@/models/pipeline'
import FieldItem from '../field-item'

const createInputVar = (overrides: Partial<InputVar> = {}): InputVar => ({
  type: PipelineInputVarType.textInput,
  label: 'Field Label',
  variable: 'field_name',
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
  ...overrides,
})

describe('FieldItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the variable, label, and required badge', () => {
    render(
      <FieldItem
        payload={createInputVar()}
        index={0}
        onClickEdit={vi.fn()}
        onRemove={vi.fn()}
      />,
    )

    expect(screen.getByText('field_name'))!.toBeInTheDocument()
    expect(screen.getByText('Field Label'))!.toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.start.required'))!.toBeInTheDocument()
  })

  it('should show edit and delete controls on hover and trigger both callbacks', () => {
    const onClickEdit = vi.fn()
    const onRemove = vi.fn()
    const { container } = render(
      <FieldItem
        payload={createInputVar({ variable: 'custom_field' })}
        index={2}
        onClickEdit={onClickEdit}
        onRemove={onRemove}
      />,
    )

    fireEvent.mouseEnter(container.firstChild!)
    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[0]!)
    fireEvent.click(buttons[1]!)

    expect(onClickEdit).toHaveBeenCalledWith('custom_field')
    expect(onRemove).toHaveBeenCalledWith(2)
  })

  it('should keep the row readonly when readonly is enabled', () => {
    const onClickEdit = vi.fn()
    const onRemove = vi.fn()
    const { container } = render(
      <FieldItem
        readonly
        payload={createInputVar()}
        index={0}
        onClickEdit={onClickEdit}
        onRemove={onRemove}
      />,
    )

    fireEvent.mouseEnter(container.firstChild!)

    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(onClickEdit).not.toHaveBeenCalled()
    expect(onRemove).not.toHaveBeenCalled()
  })
})
