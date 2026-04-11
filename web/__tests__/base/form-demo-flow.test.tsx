import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DemoForm from '@/app/components/base/form/form-scenarios/demo'

describe('Base Form Demo Flow', () => {
  const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reveals contact fields and submits the composed form values through the shared form actions', async () => {
    const user = userEvent.setup()
    render(<DemoForm />)

    expect(screen.queryByRole('heading', { name: /contacts/i })).not.toBeInTheDocument()

    await user.type(screen.getByRole('textbox', { name: /^name$/i }), 'Alice')
    await user.type(screen.getByRole('textbox', { name: /^surname$/i }), 'Smith')
    await user.click(screen.getByText(/i accept the terms and conditions/i))

    expect(await screen.findByRole('heading', { name: /contacts/i })).toBeInTheDocument()

    await user.type(screen.getByRole('textbox', { name: /^email$/i }), 'alice@example.com')

    const preferredMethodLabel = screen.getByText('Preferred Contact Method')
    const preferredMethodField = preferredMethodLabel.parentElement?.parentElement
    expect(preferredMethodField).toBeTruthy()

    await user.click(within(preferredMethodField as HTMLElement).getByText('Email'))
    await user.click(screen.getByText('Whatsapp'))

    const submitButton = screen.getByRole('button', { name: /operation\.submit/i })
    expect(submitButton).toBeEnabled()
    await user.click(submitButton)

    await waitFor(() => {
      expect(consoleLogSpy).toHaveBeenCalledWith('Form submitted:', expect.objectContaining({
        name: 'Alice',
        surname: 'Smith',
        isAcceptingTerms: true,
        contact: expect.objectContaining({
          email: 'alice@example.com',
          preferredContactMethod: 'whatsapp',
        }),
      }))
    })
  })

  it('removes the nested contact section again when the name field is cleared', async () => {
    const user = userEvent.setup()
    render(<DemoForm />)

    const nameInput = screen.getByRole('textbox', { name: /^name$/i })
    await user.type(nameInput, 'Alice')
    expect(await screen.findByRole('heading', { name: /contacts/i })).toBeInTheDocument()

    await user.clear(nameInput)

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /contacts/i })).not.toBeInTheDocument()
    })
  })
})
