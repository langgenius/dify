import type { Var } from '@/app/components/workflow/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import PrePopulate from './pre-populate'

const { mockVarReferencePicker } = vi.hoisted(() => ({
  mockVarReferencePicker: vi.fn(),
}))

type VarReferencePickerProps = {
  onChange: (value: string[]) => void
  filterVar: (v: Var) => boolean
}

vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-reference-picker', () => ({
  default: (props: VarReferencePickerProps) => {
    mockVarReferencePicker(props)
    return (
      <button type="button" onClick={() => props.onChange(['node-1', 'var-1'])}>
        pick-variable
      </button>
    )
  },
}))

describe('PrePopulate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should show placeholder initially and switch out of placeholder on Tab key', async () => {
    const user = userEvent.setup()
    render(
      <PrePopulate
        nodeId="node-1"
        isVariable={false}
        value=""
      />,
    )

    expect(screen.getByText('nodes.humanInput.insertInputField.prePopulateFieldPlaceholder')).toBeInTheDocument()

    await user.keyboard('{Tab}')

    expect(screen.queryByText('nodes.humanInput.insertInputField.prePopulateFieldPlaceholder')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('should update constant value and toggle to variable mode when type switch is clicked', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    const onIsVariableChange = vi.fn()

    const Wrapper = () => {
      const [value, setValue] = useState('initial value')
      return (
        <PrePopulate
          nodeId="node-1"
          isVariable={false}
          value={value}
          onValueChange={(next) => {
            onValueChange(next)
            setValue(next)
          }}
          onIsVariableChange={onIsVariableChange}
        />
      )
    }

    render(
      <Wrapper />,
    )

    await user.clear(screen.getByRole('textbox'))
    await user.type(screen.getByRole('textbox'), 'next')
    await user.click(screen.getByText('workflow.nodes.humanInput.insertInputField.useVarInstead'))

    expect(onValueChange).toHaveBeenLastCalledWith('next')
    expect(onIsVariableChange).toHaveBeenCalledWith(true)
  })

  it('should render variable picker mode and propagate selected value selector', async () => {
    const user = userEvent.setup()
    const onValueSelectorChange = vi.fn()
    const onIsVariableChange = vi.fn()

    render(
      <PrePopulate
        nodeId="node-2"
        isVariable
        valueSelector={['node-2', 'existing']}
        onValueSelectorChange={onValueSelectorChange}
        onIsVariableChange={onIsVariableChange}
      />,
    )

    await user.click(screen.getByText('pick-variable'))
    await user.click(screen.getByText('workflow.nodes.humanInput.insertInputField.useConstantInstead'))

    expect(onValueSelectorChange).toHaveBeenCalledWith(['node-1', 'var-1'])
    expect(onIsVariableChange).toHaveBeenCalledWith(false)
  })

  it('should pass variable type filter to picker that allows string number and secret', () => {
    render(
      <PrePopulate
        nodeId="node-3"
        isVariable
        valueSelector={['node-3', 'existing']}
      />,
    )

    const pickerProps = mockVarReferencePicker.mock.calls[0][0] as VarReferencePickerProps

    const allowString = pickerProps.filterVar({ type: 'string' } as Var)
    const allowNumber = pickerProps.filterVar({ type: 'number' } as Var)
    const allowSecret = pickerProps.filterVar({ type: 'secret' } as Var)
    const blockObject = pickerProps.filterVar({ type: 'object' } as Var)

    expect(allowString).toBe(true)
    expect(allowNumber).toBe(true)
    expect(allowSecret).toBe(true)
    expect(blockObject).toBe(false)
  })
})
