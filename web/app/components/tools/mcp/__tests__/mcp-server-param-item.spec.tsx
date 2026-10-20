import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import MCPServerParamItem from '../mcp-server-param-item'

it('edits and clears the named server parameter', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  const Harness = () => {
    const [value, setValue] = useState('existing')
    return (
      <MCPServerParamItem
        data={{ label: 'Instructions', variable: 'instructions', type: 'string' }}
        value={value}
        onChange={(value) => {
          setValue(value)
          onChange(value)
        }}
      />
    )
  }
  render(<Harness />)
  const input = screen.getByRole('textbox', { name: 'Instructions' })
  expect(input).toHaveValue('existing')
  await user.clear(input)
  expect(onChange).toHaveBeenLastCalledWith('')
  await user.type(input, 'Use this tool\nfor search')
  expect(onChange).toHaveBeenLastCalledWith('Use this tool\nfor search')
  expect(input).toHaveValue('Use this tool\nfor search')
})
