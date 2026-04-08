import { fireEvent, render, screen } from '@testing-library/react'
import SelectVarType from '../select-var-type'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { ns?: string }) => options?.ns ? `${options.ns}.${key}` : key,
  }),
}))

describe('SelectVarType', () => {
  it('should open the menu and return the selected variable type', () => {
    const onChange = vi.fn()

    render(<SelectVarType onChange={onChange} />)

    fireEvent.click(screen.getByText('common.operation.add'))
    fireEvent.click(screen.getByText('appDebug.variableConfig.checkbox'))

    expect(onChange).toHaveBeenCalledWith('checkbox')
    expect(screen.queryByText('appDebug.variableConfig.checkbox')).not.toBeInTheDocument()
  })
})
