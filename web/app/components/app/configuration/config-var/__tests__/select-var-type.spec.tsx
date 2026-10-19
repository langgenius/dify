import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SelectVarType from '../select-var-type'

describe('SelectVarType', () => {
  it('should open the menu and return the selected variable type', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<SelectVarType onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: 'common.operation.add' }))
    await user.click(screen.getByRole('menuitem', { name: 'appDebug.variableConfig.checkbox' }))

    expect(onChange).toHaveBeenCalledWith('checkbox')
    await waitFor(() => {
      expect(screen.queryByText('appDebug.variableConfig.checkbox')).not.toBeInTheDocument()
    })
  })
})
