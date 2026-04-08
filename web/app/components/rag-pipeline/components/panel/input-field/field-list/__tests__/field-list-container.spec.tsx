import type { InputVar } from '@/models/pipeline'
import { fireEvent, render, screen } from '@testing-library/react'
import { PipelineInputVarType } from '@/models/pipeline'
import FieldListContainer from '../field-list-container'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { ns?: string }) => options?.ns ? `${options.ns}.${key}` : key,
  }),
}))

vi.mock('react-sortablejs', () => ({
  ReactSortable: ({
    children,
    list,
    setList,
    disabled,
  }: {
    children: React.ReactNode
    list: Array<{ id: string }>
    setList: (list: Array<{ id: string }>) => void
    disabled?: boolean
  }) => (
    <div data-testid="sortable" data-disabled={String(disabled)}>
      {children}
      <button onClick={() => setList(list)}>same list</button>
      <button onClick={() => setList([...list].reverse())}>reverse list</button>
    </div>
  ),
}))

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

  it('should render the field items and ignore unchanged sort events', () => {
    const onListSortChange = vi.fn()
    render(
      <FieldListContainer
        inputFields={[createInputVar('field_1'), createInputVar('field_2')]}
        onListSortChange={onListSortChange}
        onRemoveField={vi.fn()}
        onEditField={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText('same list'))

    expect(screen.getAllByText('field_1')).toHaveLength(2)
    expect(screen.getAllByText('field_2')).toHaveLength(2)
    expect(onListSortChange).not.toHaveBeenCalled()
  })

  it('should forward changed sort lists and honor readonly mode', () => {
    const onListSortChange = vi.fn()
    render(
      <FieldListContainer
        readonly
        inputFields={[createInputVar('field_1'), createInputVar('field_2')]}
        onListSortChange={onListSortChange}
        onRemoveField={vi.fn()}
        onEditField={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText('reverse list'))

    expect(screen.getByTestId('sortable')).toHaveAttribute('data-disabled', 'true')
    expect(onListSortChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'field_2' }),
      expect.objectContaining({ id: 'field_1' }),
    ])
  })
})
