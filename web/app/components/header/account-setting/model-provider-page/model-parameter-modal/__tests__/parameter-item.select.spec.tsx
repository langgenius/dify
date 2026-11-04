import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ParameterItem from '../parameter-item'

vi.mock('../../hooks', () => ({
  useLanguage: () => 'en_US',
}))

describe('ParameterItem select mode', () => {
  it('should propagate a selected value', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <ParameterItem
        parameterRule={{
          name: 'format',
          label: { en_US: 'Format', zh_Hans: 'Format' },
          type: 'string',
          options: ['json', 'text'],
          required: false,
          help: { en_US: 'Help', zh_Hans: 'Help' },
        }}
        value="json"
        onChange={onChange}
      />,
    )

    await user.click(screen.getByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: 'text' }))

    expect(onChange).toHaveBeenCalledWith('text')
  })
})
