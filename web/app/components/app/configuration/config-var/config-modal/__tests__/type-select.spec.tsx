import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TypeSelector from '../type-select'

describe('TypeSelector', () => {
  it('should select a new variable type when an option is clicked', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()

    render(
      <TypeSelector
        label="Field type"
        value="text-input"
        onSelect={onSelect}
        items={[
          { value: 'text-input', name: 'Text' },
          { value: 'number', name: 'Number' },
        ]}
      />,
    )

    await user.click(screen.getByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: /^Number/ }))

    expect(onSelect).toHaveBeenCalledWith({ value: 'number', name: 'Number' })
  })
})
