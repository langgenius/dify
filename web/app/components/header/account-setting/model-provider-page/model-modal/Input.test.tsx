import { render } from '@testing-library/react'
import Input from './Input'

it('Input renders correctly as password type with no autocomplete', () => {
  const { asFragment, getByPlaceholderText } = render(
    <Input
      type="password"
      placeholder="API Key"
      onChange={vi.fn()}
    />,
  )
  const input = getByPlaceholderText('API Key')
  expect(input).toHaveAttribute('type', 'password')
  expect(input).not.toHaveAttribute('autocomplete')
  expect(asFragment()).toMatchSnapshot()
})
