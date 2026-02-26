import { render, screen } from '@testing-library/react'
import Option from './option'

const MockIcon = () => <svg aria-label="mock icon" />

describe('InputTypeSelect Option', () => {
  it('should render option label and type', () => {
    render(
      <Option
        option={{
          value: 'checkbox',
          label: 'Checkbox',
          Icon: MockIcon,
          type: 'boolean',
        }}
      />,
    )

    expect(screen.getByText('Checkbox')).toBeInTheDocument()
    expect(screen.getByText('boolean')).toBeInTheDocument()
  })
})
