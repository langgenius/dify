import { render, screen } from '@testing-library/react'
import Trigger from './trigger'

const MockIcon = () => <svg aria-label="mock icon" />

describe('InputTypeSelect Trigger', () => {
  it('should show placeholder text when no option is selected', () => {
    render(<Trigger option={undefined} open={false} />)
    expect(screen.getByText('common.placeholder.select')).toBeInTheDocument()
  })

  it('should show selected option label and type', () => {
    render(
      <Trigger
        option={{
          value: 'text-input',
          label: 'Text Input',
          Icon: MockIcon,
          type: 'string',
        }}
        open={false}
      />,
    )

    expect(screen.getByText('Text Input')).toBeInTheDocument()
    expect(screen.getByText('string')).toBeInTheDocument()
  })
})
