import { render, screen } from '@testing-library/react'
import Item from '../item'

describe('GlobalVariablePanel Item', () => {
  it('renders the global variable name, type, and description', () => {
    render(
      <Item
        payload={{
          name: 'timezone',
          value_type: 'string',
          description: 'Current timezone',
        }}
      />,
    )

    expect(screen.getByText('sys.')).toBeInTheDocument()
    expect(screen.getByText('timezone')).toBeInTheDocument()
    expect(screen.getByText('String')).toBeInTheDocument()
    expect(screen.getByText('Current timezone')).toBeInTheDocument()
  })
})
