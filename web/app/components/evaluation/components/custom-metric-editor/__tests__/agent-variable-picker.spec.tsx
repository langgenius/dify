import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import AgentVariablePicker from '../agent-variable-picker'

describe('AgentVariablePicker', () => {
  it('maps a selected Agent evaluation field to the target Agent scope', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <AgentVariablePicker
        placeholder="Select an output variable"
        value={null}
        onChange={onChange}
      />,
    )

    await user.click(screen.getByRole('combobox', { name: 'Select an output variable' }))
    await user.click(await screen.findByRole('option', { name: /trajectory_json/ }))

    expect(onChange).toHaveBeenCalledWith('agent.trajectory_json')
  })

  it('restores a persisted Agent selector', () => {
    render(
      <AgentVariablePicker
        placeholder="Select an output variable"
        value="{{#agent.output#}}"
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('combobox', { name: 'Select an output variable' })).toHaveTextContent(
      'output',
    )
  })
})
