import type { SortableItem } from '../types'
import type { InputVar } from '@/models/pipeline'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
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
    render(
      <FieldListContainer
        inputFields={[createInputVar('field_1'), createInputVar('field_2')]}
        onListSortChange={onListSortChange}
        onRemoveField={vi.fn()}
        onEditField={vi.fn()}
      />,
    )

    expect(screen.getAllByText('field_1').length).toBeGreaterThan(0)
    expect(screen.getAllByText('field_2').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: /sort.handle/ })).toHaveLength(2)
    expect(onListSortChange).not.toHaveBeenCalled()
  })

  it('moves fields in both directions by clicking and disables movement past the ends', async () => {
    const user = userEvent.setup()
    const onListSortChange = vi.fn()
    const EditableFields = () => {
      const [fields, setFields] = useState(() => [
        createInputVar('first'),
        createInputVar('second'),
      ])
      const handleSort = (list: SortableItem[]) => {
        onListSortChange(list)
        setFields(list)
      }
      return (
        <FieldListContainer
          inputFields={fields}
          onListSortChange={handleSort}
          onRemoveField={vi.fn()}
          onEditField={vi.fn()}
        />
      )
    }
    render(<EditableFields />)

    expect(screen.getAllByRole('button', { name: 'common.operation.moveUp' })[0]).toBeDisabled()
    expect(screen.getAllByRole('button', { name: 'common.operation.moveDown' })[1]).toBeDisabled()
    await user.click(screen.getAllByRole('button', { name: 'common.operation.moveDown' })[0]!)
    expect(onListSortChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ variable: 'second', id: 'second' }),
      expect.objectContaining({ variable: 'first', id: 'first' }),
    ])
    await user.click(screen.getAllByRole('button', { name: 'common.operation.moveUp' })[1]!)
    expect(onListSortChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ variable: 'first', id: 'first' }),
      expect.objectContaining({ variable: 'second', id: 'second' }),
    ])
  })

  it('should honor readonly mode for the rendered field rows', () => {
    render(
      <FieldListContainer
        readonly
        inputFields={[createInputVar('field_1'), createInputVar('field_2')]}
        onListSortChange={vi.fn()}
        onRemoveField={vi.fn()}
        onEditField={vi.fn()}
      />,
    )

    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
  it('commits the preview order with the sortable payload only after keyboard confirmation', async () => {
    const user = userEvent.setup()
    const onListSortChange = vi.fn()
    const inputFields = [createInputVar('first'), createInputVar('second')]
    render(
      <FieldListContainer
        inputFields={inputFields}
        onListSortChange={onListSortChange}
        onRemoveField={vi.fn()}
        onEditField={vi.fn()}
      />,
    )
    const handle = screen.getAllByRole('button', { name: /sort.handle/ })[0]!
    handle.focus()
    await user.keyboard('{Enter}{ArrowDown}')
    expect(handle).toHaveFocus()
    expect(onListSortChange).not.toHaveBeenCalled()
    await user.keyboard('{Enter}')
    expect(onListSortChange).toHaveBeenCalledExactlyOnceWith([
      expect.objectContaining({ variable: 'second', id: 'second' }),
      expect.objectContaining({ variable: 'first', id: 'first' }),
    ])
  })
})
