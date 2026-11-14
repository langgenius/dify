import type { InputVar } from '@/models/pipeline'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

  it('supports editing and deleting using the keyboard without hovering the row', async () => {
    const user = userEvent.setup()
    const onClickEdit = vi.fn()
    const onRemove = vi.fn()
    render(
      <FieldItem
        payload={createInputVar({ variable: 'custom_field' })}
        index={2}
        onClickEdit={onClickEdit}
        onRemove={onRemove}
      />,
    )

    expect(screen.getByText('custom_field')).toBeInTheDocument()
    expect(screen.getByText('Field Label')).toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.start.required')).toBeInTheDocument()
    await user.tab()
    expect(screen.getByRole('button', { name: 'common.operation.edit' })).toHaveFocus()
    await user.keyboard('{Enter}')
    await user.tab()
    expect(screen.getByRole('button', { name: 'common.operation.remove' })).toHaveFocus()
    await user.keyboard(' ')

    expect(onClickEdit).toHaveBeenCalledWith('custom_field')
    expect(onRemove).toHaveBeenCalledWith(2)
  })

  it('should keep the row readonly when readonly is enabled', () => {
    const onClickEdit = vi.fn()
    const onRemove = vi.fn()
    render(
      <FieldItem
        readonly
        payload={createInputVar()}
        index={0}
        onClickEdit={onClickEdit}
        onRemove={onRemove}
      />,
    )

    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})
