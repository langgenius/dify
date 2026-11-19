import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import VariableTypeSelector from '../variable-type-select'

describe('VariableTypeSelector', () => {
  it('opens the selector and applies a new type', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <VariableTypeSelector
        value="string"
        list={['string', 'number', 'boolean']}
        onSelect={onSelect}
      />,
    )

    await user.click(screen.getByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: 'number' }))

    expect(onSelect).toHaveBeenCalledWith('number')
  })
})
