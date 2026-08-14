import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VarType } from '@/app/components/workflow/nodes/tool/types'
import FormInputTypeSwitch from '../form-input-type-switch'

describe('FormInputTypeSwitch', () => {
  it('changes the required input type selection', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<FormInputTypeSwitch value={VarType.variable} onChange={onChange} />)

    expect(
      screen.getByRole('radio', { name: 'workflow.nodes.common.typeSwitch.variable' }),
    ).toHaveAttribute('aria-checked', 'true')

    await user.click(screen.getByRole('radio', { name: 'workflow.nodes.common.typeSwitch.input' }))

    expect(onChange).toHaveBeenCalledWith(VarType.constant)
  })

  it('disables both input type options when read-only', () => {
    render(<FormInputTypeSwitch value={VarType.constant} onChange={vi.fn()} readonly />)

    expect(
      screen.getByRole('radio', { name: 'workflow.nodes.common.typeSwitch.variable' }),
    ).toBeDisabled()
    expect(
      screen.getByRole('radio', { name: 'workflow.nodes.common.typeSwitch.input' }),
    ).toBeDisabled()
  })
})
