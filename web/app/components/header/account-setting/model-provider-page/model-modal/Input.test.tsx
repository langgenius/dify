import { render } from '@testing-library/react'
import Input from './Input'

test('Input renders correctly as password type with no autocomplete', () => {
  const { asFragment, getByPlaceholderText } = render(
    <Input
      type="password"
      placeholder="API Key"
      onChange={jest.fn()}
    />,
  )
  const input = getByPlaceholderText('API Key')
  expect(input).toHaveAttribute('type', 'password')
  expect(input).not.toHaveAttribute('autocomplete')
  expect(asFragment()).toMatchSnapshot()
})
