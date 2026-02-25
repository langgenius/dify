import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TypeSwitch from './type-switch'

describe('TypeSwitch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render use variable text when isVariable is false and toggle to true on click', async () => {
    const user = userEvent.setup()
    const onIsVariableChange = vi.fn()

    render(
      <TypeSwitch isVariable={false} onIsVariableChange={onIsVariableChange} />,
    )

    const trigger = screen.getByText('workflow.nodes.humanInput.insertInputField.useVarInstead')
    await user.click(trigger)

    expect(onIsVariableChange).toHaveBeenCalledWith(true)
  })

  it('should render use constant text when isVariable is true and toggle to false on click', async () => {
    const user = userEvent.setup()
    const onIsVariableChange = vi.fn()

    render(
      <TypeSwitch isVariable onIsVariableChange={onIsVariableChange} />,
    )

    const trigger = screen.getByText('workflow.nodes.humanInput.insertInputField.useConstantInstead')
    await user.click(trigger)

    expect(onIsVariableChange).toHaveBeenCalledWith(false)
  })
})
