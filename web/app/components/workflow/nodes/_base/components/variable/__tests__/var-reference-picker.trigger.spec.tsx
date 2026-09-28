import type { ComponentProps } from 'react'
import { Popover, PopoverContent } from '@langgenius/dify-ui/popover'
import { fireEvent, render, screen } from '@testing-library/react'
import { VarKindType } from '@/app/components/workflow/nodes/_base/types'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import VarReferencePickerTrigger from '../var-reference-picker.trigger'

const createProps = (
  overrides: Partial<ComponentProps<typeof VarReferencePickerTrigger>> = {},
): ComponentProps<typeof VarReferencePickerTrigger> => ({
  controlFocus: 0,
  handleClearVar: vi.fn(),
  handleVarKindTypeChange: vi.fn(),
  handleVariableJump: vi.fn(),
  hasValue: false,
  inputRef: { current: null },
  isConstant: false,
  isException: false,
  isFocus: false,
  isLoading: false,
  isShowAPart: false,
  isShowNodeName: true,
  maxNodeNameWidth: 80,
  maxTypeWidth: 60,
  maxVarNameWidth: 80,
  onChange: vi.fn(),
  open: false,
  outputVarNode: null,
  readonly: false,
  setControlFocus: vi.fn(),
  setOpen: vi.fn(),
  hoverPopup: null,
  triggerRef: { current: null },
  value: [],
  varKindType: VarKindType.constant,
  varKindTypes: [
    { label: 'Variable', value: VarKindType.variable },
    { label: 'Constant', value: VarKindType.constant },
  ],
  varName: '',
  variableCategory: 'system',
  ...overrides,
})

const renderWithPopover = (
  overrides: Partial<ComponentProps<typeof VarReferencePickerTrigger>> = {},
) => {
  const onOpenChange = vi.fn()

  render(
    <Popover onOpenChange={onOpenChange}>
      <VarReferencePickerTrigger {...createProps(overrides)} />
      <PopoverContent className="border-none bg-transparent p-0 shadow-none">
        <div>picker-content</div>
      </PopoverContent>
    </Popover>,
  )

  return { onOpenChange }
}

describe('VarReferencePickerTrigger', () => {
  it('should show the placeholder state and open the picker for variable mode', () => {
    const { onOpenChange } = renderWithPopover({
      placeholder: 'Pick variable',
    })

    expect(screen.getByText('Pick variable'))!.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('var-reference-picker-trigger'))
    expect(onOpenChange).toHaveBeenCalledWith(true, expect.anything())
  })

  it('should render the selected variable state and clear it', () => {
    const handleClearVar = vi.fn()
    const handleVariableJump = vi.fn()

    renderWithPopover({
      handleClearVar,
      handleVariableJump,
      hasValue: true,
      outputVarNode: { title: 'Source Node', desc: '', type: BlockEnum.Code },
      outputVarNodeId: 'node-a',
      type: VarType.string,
      value: ['node-a', 'answer'],
      varName: 'answer',
    })

    expect(screen.getByText('Source Node'))!.toBeInTheDocument()
    expect(screen.getByText('answer'))!.toBeInTheDocument()

    fireEvent.click(screen.getByText('Source Node'), { ctrlKey: true })
    expect(handleVariableJump).toHaveBeenCalledWith('node-a')

    fireEvent.click(screen.getByRole('button', { name: /Clear|operation.clear/ }))
    expect(handleClearVar).toHaveBeenCalledTimes(1)
  })

  it('should render the support-constant trigger and focus constant input when clicked', () => {
    const setControlFocus = vi.fn()
    const setOpen = vi.fn()

    renderWithPopover({
      isConstant: true,
      isSupportConstantValue: true,
      schemaWithDynamicSelect: {
        type: 'text-input',
      } as never,
      setOpen,
      setControlFocus,
      value: 'constant-value',
    })

    fireEvent.click(screen.getByTestId('var-reference-picker-trigger'))
    expect(setControlFocus).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByText('Constant'))
    expect(setOpen).toHaveBeenCalledWith(false)
  })

  it('should render add button trigger in table mode', () => {
    renderWithPopover({
      hasValue: true,
      isAddBtnTrigger: true,
      isInTable: true,
      value: ['node-a', 'answer'],
      varName: 'answer',
    })

    expect(screen.getByRole('button', { name: 'common.operation.add' }))!.toBeInTheDocument()
  })

  it('should stay inert in readonly mode and show value type placeholder badge', () => {
    const { onOpenChange } = renderWithPopover({
      placeholder: 'Readonly placeholder',
      readonly: true,
      typePlaceHolder: 'string',
      valueTypePlaceHolder: 'text',
    })

    fireEvent.click(screen.getByTestId('var-reference-picker-trigger'))
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByText('string'))!.toBeInTheDocument()
    expect(screen.getByText('text'))!.toBeInTheDocument()
  })

  it('should show loading placeholder and remove rows in table mode', () => {
    const onRemove = vi.fn()

    renderWithPopover({
      hasValue: false,
      isInTable: true,
      isLoading: true,
      onRemove,
      placeholder: 'Loading variable',
    })

    expect(screen.getByText('Loading variable'))!.toBeInTheDocument()

    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[buttons.length - 1]!)
    expect(onRemove).toHaveBeenCalledTimes(1)
  })

  const treeOptions = [
    {
      value: 'parent-a',
      label: { en_US: 'Parent A', zh_Hans: 'Parent A' },
      show_on: [],
      children: [
        {
          value: 'child-a1',
          label: { en_US: 'Child A1', zh_Hans: 'Child A1' },
          show_on: [],
        },
      ],
    },
    {
      value: 'parent-b',
      label: { en_US: 'Parent B', zh_Hans: 'Parent B' },
      show_on: [],
    },
  ]

  it('should select one tree node and report when the panel opens', () => {
    const onChange = vi.fn()
    const onConstantFieldOpenChange = vi.fn()

    renderWithPopover({
      isConstant: true,
      isSupportConstantValue: true,
      onChange,
      onConstantFieldOpenChange,
      schemaWithDynamicSelect: {
        options: treeOptions,
        type: 'dynamic-tree-select',
        variable: 'field',
      } as never,
      value: 'child-a1',
    })

    fireEvent.click(screen.getByRole('button', { name: 'Child A1' }))
    expect(onConstantFieldOpenChange).toHaveBeenCalledWith(true)
    fireEvent.click(screen.getByRole('option', { name: 'Parent B' }))
    expect(onChange).toHaveBeenCalledWith('parent-b', VarKindType.constant)
  })

  it('should keep multiple tree selections when the schema flag is truthy', () => {
    const onChange = vi.fn()

    renderWithPopover({
      isConstant: true,
      isSupportConstantValue: true,
      onChange,
      schemaWithDynamicSelect: {
        multiple: 'true',
        options: treeOptions,
        type: 'dynamic-tree-select',
        variable: 'field',
      } as never,
      value: ['parent-a', 1] as never,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Parent A' }))
    fireEvent.click(screen.getByRole('option', { name: 'Parent B' }))
    expect(onChange).toHaveBeenCalledWith(['parent-a', 'parent-b'], VarKindType.constant)
  })

  it('should treat a false multiple flag as a single tree selection', () => {
    const onChange = vi.fn()

    renderWithPopover({
      isConstant: true,
      isSupportConstantValue: true,
      onChange,
      schemaWithDynamicSelect: {
        multiple: 'false',
        options: treeOptions,
        type: 'dynamic-tree-select',
        variable: 'field',
      } as never,
      value: '',
    })

    fireEvent.click(screen.getByRole('button', { name: 'common.placeholder.select' }))
    fireEvent.click(screen.getByRole('option', { name: 'Parent B' }))
    expect(onChange).toHaveBeenCalledWith('parent-b', VarKindType.constant)
  })

  it('should treat numeric multiple flags as multi-select and ignore non-string number values', () => {
    const onChange = vi.fn()

    renderWithPopover({
      isConstant: true,
      isSupportConstantValue: true,
      onChange,
      schemaWithDynamicSelect: {
        multiple: 1,
        options: treeOptions,
        type: 'dynamic-tree-select',
        variable: 'field',
      } as never,
      value: [],
    })
    fireEvent.click(screen.getByRole('button', { name: 'common.placeholder.select' }))
    fireEvent.click(screen.getByRole('option', { name: 'Parent A' }))
    expect(onChange).toHaveBeenCalledWith(['parent-a'], VarKindType.constant)
  })

  it('should clear a number constant when the stored value is not text', () => {
    renderWithPopover({
      isConstant: true,
      isSupportConstantValue: true,
      schemaWithDynamicSelect: {
        type: 'number-input',
      } as never,
      value: ['not-a-number'],
    })

    expect(document.querySelector('input[type="number"]')).toHaveProperty('value', '')
  })
})
