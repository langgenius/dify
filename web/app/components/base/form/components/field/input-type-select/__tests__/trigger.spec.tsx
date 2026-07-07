import { render, screen } from '@testing-library/react'
import Trigger from '../trigger'

const MockIcon = () => <svg aria-label="mock icon" />

describe('InputTypeSelect Trigger', () => {
  it('should show placeholder text when no option is selected', () => {
    render(<Trigger option={undefined} />)
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
      />,
    )

    expect(screen.getByText('Text Input')).toBeInTheDocument()
    expect(screen.getByText('string')).toBeInTheDocument()
  })

  it('should keep selected option parts in one inline flex row', () => {
    render(
      <Trigger
        option={{
          value: 'text-input',
          label: 'Text Input',
          Icon: MockIcon,
          type: 'string',
        }}
      />,
    )

    expect(screen.getByText('Text Input').parentElement).toHaveClass('flex', 'min-w-0', 'items-center', 'gap-x-0.5')
  })
})
