import { fireEvent, render, screen } from '@testing-library/react'
import AddModelButton from './add-model-button'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string) => 'Add Model',
  }),
}))

describe('AddModelButton', () => {
  it('should render button with text', () => {
    render(<AddModelButton onClick={vi.fn()} />)
    expect(screen.getByText('Add Model')).toBeInTheDocument()
  })

  it('should call onClick when clicked', () => {
    const handleClick = vi.fn()
    render(<AddModelButton onClick={handleClick} />)
    const button = screen.getByText('Add Model')
    fireEvent.click(button)
    expect(handleClick).toHaveBeenCalledTimes(1)
  })
})
