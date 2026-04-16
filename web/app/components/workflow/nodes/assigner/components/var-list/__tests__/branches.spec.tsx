import type { ComponentProps } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VarType } from '@/app/components/workflow/types'
import { AssignerNodeInputType, WriteMode } from '../../../types'
import VarList from '../index'

vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-reference-picker', () => ({
  __esModule: true,
  default: ({
    popupFor = 'assigned',
    onOpen,
    onChange,
  }: {
    popupFor?: string
    onOpen?: () => void
    onChange: (value: string[]) => void
  }) => (
    <div>
      <button type="button" data-testid={`${popupFor}-picker-trigger`} onClick={onOpen}>
        open-
        {popupFor}
      </button>
      <button
        type="button"
        onClick={() => onChange(popupFor === 'assigned' ? ['node-b', 'total'] : ['node-c', 'result'])}
      >
        select-
        {popupFor}
      </button>
    </div>
  ),
}))

vi.mock('../../operation-selector', () => ({
  __esModule: true,
  default: ({
    onSelect,
  }: {
    onSelect: (item: { value: string }) => void
  }) => (
    <div>
      <button type="button" onClick={() => onSelect({ value: WriteMode.set })}>operation-set</button>
      <button type="button" onClick={() => onSelect({ value: WriteMode.overwrite })}>operation-overwrite</button>
    </div>
  ),
}))

const createOperation = (
  overrides: Partial<ComponentProps<typeof VarList>['list'][number]> = {},
): ComponentProps<typeof VarList>['list'][number] => ({
  variable_selector: ['node-a', 'flag'],
  input_type: AssignerNodeInputType.variable,
  operation: WriteMode.overwrite,
  value: ['node-a', 'answer'],
  ...overrides,
})

const renderVarList = (props: Partial<ComponentProps<typeof VarList>> = {}) => {
  const handleChange = vi.fn()
  const handleOpen = vi.fn()

  const result = render(
    <VarList
      readonly={false}
      nodeId="node-current"
      list={[]}
      onChange={handleChange}
      onOpen={handleOpen}
      getAssignedVarType={() => VarType.string}
      getToAssignedVarType={() => VarType.string}
      writeModeTypes={[WriteMode.overwrite, WriteMode.clear, WriteMode.set]}
      writeModeTypesArr={[WriteMode.overwrite, WriteMode.clear]}
      writeModeTypesNum={[WriteMode.increment]}
      {...props}
    />,
  )

  return {
    ...result,
    handleChange,
    handleOpen,
  }
}

describe('assigner/var-list branches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resets operation metadata when the assigned variable changes', async () => {
    const user = userEvent.setup()
    const { handleChange, handleOpen } = renderVarList({
      list: [createOperation({
        operation: WriteMode.set,
        input_type: AssignerNodeInputType.constant,
        value: 'stale',
      })],
    })

    await user.click(screen.getByTestId('assigned-picker-trigger'))
    await user.click(screen.getByRole('button', { name: 'select-assigned' }))

    expect(handleOpen).toHaveBeenCalledWith(0)
    expect(handleChange).toHaveBeenLastCalledWith([
      createOperation({
        variable_selector: ['node-b', 'total'],
        operation: WriteMode.overwrite,
        input_type: AssignerNodeInputType.variable,
        value: undefined,
      }),
    ], ['node-b', 'total'])
  })

  it('switches back to variable mode when the selected operation no longer requires a constant', async () => {
    const user = userEvent.setup()
    const { handleChange } = renderVarList({
      list: [createOperation({
        operation: WriteMode.set,
        input_type: AssignerNodeInputType.constant,
        value: 'hello',
      })],
    })

    await user.click(screen.getByRole('button', { name: 'operation-overwrite' }))

    expect(handleChange).toHaveBeenLastCalledWith([
      createOperation({
        operation: WriteMode.overwrite,
        input_type: AssignerNodeInputType.variable,
        value: '',
      }),
    ])
  })

  it('updates string and number constant inputs through the inline editors', () => {
    const { handleChange, rerender } = renderVarList({
      list: [createOperation({
        operation: WriteMode.set,
        input_type: AssignerNodeInputType.constant,
        value: 1,
      })],
      getAssignedVarType: () => VarType.number,
      getToAssignedVarType: () => VarType.number,
    })

    fireEvent.change(screen.getByRole('spinbutton'), {
      target: { value: '2' },
    })

    expect(handleChange).toHaveBeenLastCalledWith([
      createOperation({
        operation: WriteMode.set,
        input_type: AssignerNodeInputType.constant,
        value: 2,
      }),
    ], 2)

    rerender(
      <VarList
        readonly={false}
        nodeId="node-current"
        list={[createOperation({
          operation: WriteMode.set,
          input_type: AssignerNodeInputType.constant,
          value: 'hello',
        })]}
        onChange={handleChange}
        onOpen={vi.fn()}
        getAssignedVarType={() => VarType.string}
        getToAssignedVarType={() => VarType.string}
        writeModeTypes={[WriteMode.overwrite, WriteMode.clear, WriteMode.set]}
        writeModeTypesArr={[WriteMode.overwrite, WriteMode.clear]}
        writeModeTypesNum={[WriteMode.increment]}
      />,
    )

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'updated' },
    })

    expect(handleChange).toHaveBeenLastCalledWith([
      createOperation({
        operation: WriteMode.set,
        input_type: AssignerNodeInputType.constant,
        value: 'updated',
      }),
    ], 'updated')
  })

  it('updates numeric write-mode inputs through the dedicated number field', () => {
    const { handleChange } = renderVarList({
      list: [createOperation({
        operation: WriteMode.increment,
        value: 2,
      })],
      getAssignedVarType: () => VarType.number,
      getToAssignedVarType: () => VarType.number,
      writeModeTypesNum: [WriteMode.increment],
    })

    fireEvent.change(screen.getByRole('spinbutton'), {
      target: { value: '5' },
    })

    expect(handleChange).toHaveBeenLastCalledWith([
      createOperation({
        operation: WriteMode.increment,
        value: 5,
      }),
    ], 5)
  })
})
