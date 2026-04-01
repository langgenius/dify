import type { ComponentProps } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { VarType as VarKindType } from '../../../../tool/types'
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
  tooltipPopup: null,
  triggerRef: { current: null },
  value: [],
  varKindType: VarKindType.constant,
  varKindTypes: [
    { label: 'Variable', value: VarKindType.variable },
    { label: 'Constant', value: VarKindType.constant },
  ],
  varName: '',
  variableCategory: 'system',
  WrapElem: 'div',
  VarPickerWrap: 'div',
  ...overrides,
})

describe('VarReferencePickerTrigger', () => {
  it('should show the placeholder state and open the picker for variable mode', () => {
    const setOpen = vi.fn()
    render(
      <VarReferencePickerTrigger
        {...createProps({
          placeholder: 'Pick variable',
          setOpen,
        })}
      />,
    )

    expect(screen.getByText('Pick variable')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('var-reference-picker-trigger'))
    expect(setOpen).toHaveBeenCalledWith(true)
  })

  it('should render the selected variable state and clear it', () => {
    const handleClearVar = vi.fn()
    const handleVariableJump = vi.fn()

    render(
      <VarReferencePickerTrigger
        {...createProps({
          handleClearVar,
          handleVariableJump,
          hasValue: true,
          outputVarNode: { title: 'Source Node', desc: '', type: BlockEnum.Code },
          outputVarNodeId: 'node-a',
          type: VarType.string,
          value: ['node-a', 'answer'],
          varName: 'answer',
        })}
      />,
    )

    expect(screen.getByText('Source Node')).toBeInTheDocument()
    expect(screen.getByText('answer')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Source Node'), { ctrlKey: true })
    expect(handleVariableJump).toHaveBeenCalledWith('node-a')

    fireEvent.click(screen.getByTestId('var-reference-picker-clear'))
    expect(handleClearVar).toHaveBeenCalledTimes(1)
  })

  it('should render the support-constant trigger and focus constant input when clicked', () => {
    const setControlFocus = vi.fn()
    const setOpen = vi.fn()

    render(
      <VarReferencePickerTrigger
        {...createProps({
          isConstant: true,
          isSupportConstantValue: true,
          schemaWithDynamicSelect: {
            type: 'text-input',
          } as never,
          setOpen,
          setControlFocus,
          value: 'constant-value',
        })}
      />,
    )

    fireEvent.click(screen.getByTestId('var-reference-picker-trigger'))
    expect(setControlFocus).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByText('Constant'))
    expect(setOpen).toHaveBeenCalledWith(false)
  })

  it('should render add button trigger in table mode', () => {
    render(
      <VarReferencePickerTrigger
        {...createProps({
          hasValue: true,
          isAddBtnTrigger: true,
          isInTable: true,
          value: ['node-a', 'answer'],
          varName: 'answer',
        })}
      />,
    )

    expect(document.querySelector('button')).toBeInTheDocument()
  })

  it('should stay inert in readonly mode and show value type placeholder badge', () => {
    const setOpen = vi.fn()

    render(
      <VarReferencePickerTrigger
        {...createProps({
          placeholder: 'Readonly placeholder',
          readonly: true,
          setOpen,
          typePlaceHolder: 'string',
          valueTypePlaceHolder: 'text',
        })}
      />,
    )

    fireEvent.click(screen.getByTestId('var-reference-picker-trigger'))
    expect(setOpen).not.toHaveBeenCalled()
    expect(screen.getByText('string')).toBeInTheDocument()
    expect(screen.getByText('text')).toBeInTheDocument()
  })

  it('should show loading placeholder and remove rows in table mode', () => {
    const onRemove = vi.fn()

    render(
      <VarReferencePickerTrigger
        {...createProps({
          hasValue: false,
          isInTable: true,
          isLoading: true,
          onRemove,
          placeholder: 'Loading variable',
        })}
      />,
    )

    expect(screen.getByText('Loading variable')).toBeInTheDocument()

    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[buttons.length - 1])
    expect(onRemove).toHaveBeenCalledTimes(1)
  })
})
