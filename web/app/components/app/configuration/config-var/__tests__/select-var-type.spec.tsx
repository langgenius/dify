import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import SelectVarType from '../select-var-type'

describe('SelectVarType', () => {
  it('should open the menu and return the selected variable type', async () => {
    const onChange = vi.fn()

    render(<SelectVarType onChange={onChange} />)

    fireEvent.click(screen.getByText('common.operation.add'))
    fireEvent.click(screen.getByText('appDebug.variableConfig.checkbox'))

    expect(onChange).toHaveBeenCalledWith('checkbox')
    await waitFor(() => {
      expect(screen.queryByText('appDebug.variableConfig.checkbox')).not.toBeInTheDocument()
    })
  })
})
