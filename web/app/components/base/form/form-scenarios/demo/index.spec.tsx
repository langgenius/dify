import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import DemoForm from './index'

describe('DemoForm', () => {
  const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the primary fields', () => {
    render(<DemoForm />)

    expect(screen.getByRole('textbox', { name: /^name$/i })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /^surname$/i })).toBeInTheDocument()
    expect(screen.getByText(/i accept the terms and conditions/i)).toBeInTheDocument()
  })

  it('should show contact fields after a name is entered', () => {
    render(<DemoForm />)

    expect(screen.queryByRole('heading', { name: /contacts/i })).not.toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox', { name: /^name$/i }), { target: { value: 'Alice' } })

    expect(screen.getByRole('heading', { name: /contacts/i })).toBeInTheDocument()
  })

  it('should hide contact fields when name is cleared', () => {
    render(<DemoForm />)
    const nameInput = screen.getByRole('textbox', { name: /^name$/i })

    fireEvent.change(nameInput, { target: { value: 'Alice' } })
    expect(screen.getByRole('heading', { name: /contacts/i })).toBeInTheDocument()

    fireEvent.change(nameInput, { target: { value: '' } })
    expect(screen.queryByRole('heading', { name: /contacts/i })).not.toBeInTheDocument()
  })

  it('should log validation errors on invalid submit', () => {
    render(<DemoForm />)
    const nameInput = screen.getByRole('textbox', { name: /^name$/i }) as HTMLInputElement

    fireEvent.submit(nameInput.form!)

    return waitFor(() => {
      expect(consoleLogSpy).toHaveBeenCalledWith('Validation errors:', expect.any(Array))
    })
  })

  it('should log submitted values on valid submit', () => {
    render(<DemoForm />)
    const nameInput = screen.getByRole('textbox', { name: /^name$/i }) as HTMLInputElement

    fireEvent.change(nameInput, { target: { value: 'Alice' } })
    fireEvent.change(screen.getByRole('textbox', { name: /^surname$/i }), { target: { value: 'Smith' } })
    fireEvent.click(screen.getByText(/i accept the terms and conditions/i))
    fireEvent.change(screen.getByRole('textbox', { name: /email/i }), { target: { value: 'alice@example.com' } })
    fireEvent.submit(nameInput.form!)

    return waitFor(() => {
      expect(consoleLogSpy).toHaveBeenCalledWith('Form submitted:', expect.objectContaining({
        name: 'Alice',
        surname: 'Smith',
        isAcceptingTerms: true,
      }))
    })
  })
})
