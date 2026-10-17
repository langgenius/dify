import type { ComponentProps } from 'react'
import { Popover, PopoverContent } from '@langgenius/dify-ui/popover'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VarKindType } from '@/app/components/workflow/nodes/_base/types'
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
  it('opens the variable picker from the add action in a table', async () => {
    renderWithPopover({
      hasValue: true,
      isAddBtnTrigger: true,
      isInTable: true,
      value: ['node-a', 'answer'],
      varName: 'answer',
    })

    await userEvent.setup().click(screen.getByRole('button', { name: 'common.operation.add' }))
    expect(await screen.findByText('picker-content')).toBeVisible()
  })

  it('removes a table row while its variable is loading', async () => {
    const onRemove = vi.fn()

    renderWithPopover({
      hasValue: false,
      isInTable: true,
      isLoading: true,
      onRemove,
      placeholder: 'Loading variable',
    })

    expect(screen.getByText('Loading variable'))!.toBeInTheDocument()

    await userEvent.setup().click(screen.getByRole('button', { name: 'common.operation.remove' }))
    expect(onRemove).toHaveBeenCalledTimes(1)
  })
})
