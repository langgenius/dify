import { fireEvent, render, screen } from '@testing-library/react'
import AddModelButton from './add-model-button'

describe('AddModelButton', () => {
  it('should render button with text', () => {
    render(<AddModelButton onClick={vi.fn()} />)
    expect(screen.getByText('common.modelProvider.addModel')).toBeInTheDocument()
  })

  it('should call onClick when clicked', () => {
    const handleClick = vi.fn()
    render(<AddModelButton onClick={handleClick} />)
    const button = screen.getByText('common.modelProvider.addModel')
    fireEvent.click(button)
    expect(handleClick).toHaveBeenCalledTimes(1)
  })
})
