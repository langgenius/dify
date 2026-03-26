import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import ToggleButton from '../toggle-button'

vi.mock('@/app/components/workflow/shortcuts-name', () => ({
  default: ({ keys }: { keys: string[] }) => (
    <span data-testid="shortcuts">{keys.join('+')}</span>
  ),
}))

describe('ToggleButton', () => {
  it('should render collapse arrow when expanded', () => {
    render(<ToggleButton expand handleToggle={vi.fn()} />)
    const button = screen.getByRole('button')
    expect(button).toBeInTheDocument()
  })

  it('should render expand arrow when collapsed', () => {
    render(<ToggleButton expand={false} handleToggle={vi.fn()} />)
    const button = screen.getByRole('button')
    expect(button).toBeInTheDocument()
  })

  it('should call handleToggle when clicked', async () => {
    const user = userEvent.setup()
    const handleToggle = vi.fn()
    render(<ToggleButton expand handleToggle={handleToggle} />)

    await user.click(screen.getByRole('button'))

    expect(handleToggle).toHaveBeenCalledTimes(1)
  })

  it('should apply custom className', () => {
    render(<ToggleButton expand handleToggle={vi.fn()} className="custom-class" />)
    const button = screen.getByRole('button')
    expect(button).toHaveClass('custom-class')
  })

  it('should have rounded-full style', () => {
    render(<ToggleButton expand handleToggle={vi.fn()} />)
    const button = screen.getByRole('button')
    expect(button).toHaveClass('rounded-full')
  })
})
