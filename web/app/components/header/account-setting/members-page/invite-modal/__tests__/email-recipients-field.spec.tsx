import type { EmailRecipient } from '../email-recipients'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { EmailRecipientsField } from '../email-recipients-field'

const EmailRecipientsFieldWrapper = () => {
  const [recipients, setRecipients] = useState<EmailRecipient[]>([])

  return (
    <EmailRecipientsField
      recipients={recipients}
      onRecipientsChange={setRecipients}
      remainingSeats={2}
    />
  )
}

describe('EmailRecipientsField', () => {
  it('describes the multi-email interaction without an infotip', () => {
    render(<EmailRecipientsFieldWrapper />)

    const input = screen.getByRole('textbox', { name: /members\.emailRecipients/i })

    expect(input).toHaveAttribute('type', 'email')
    expect(input).toHaveAttribute('multiple')
    expect(input).toHaveAccessibleDescription(/members\.emailRecipientsTip/i)
  })

  it('creates visible recipients from delimiters and removes duplicates case-insensitively', async () => {
    const user = userEvent.setup()
    render(<EmailRecipientsFieldWrapper />)

    const input = screen.getByRole('textbox', { name: /members\.emailRecipients/i })
    await user.click(input)
    await user.paste('First@Example.com, second@example.com; FIRST@example.com third@example.com')

    const recipientList = screen.getByRole('list', { name: /members\.emailRecipients/i })
    expect(within(recipientList).getAllByRole('listitem')).toHaveLength(3)
    expect(within(recipientList).getByText('first@example.com')).toBeInTheDocument()
    expect(within(recipientList).getByText('second@example.com')).toBeInTheDocument()
    expect(within(recipientList).getByText('third@example.com')).toBeInTheDocument()
  })

  it('keeps invalid pasted recipients visible and exposes their error state', async () => {
    const user = userEvent.setup()
    render(<EmailRecipientsFieldWrapper />)

    const input = screen.getByRole('textbox', { name: /members\.emailRecipients/i })
    await user.click(input)
    await user.paste('valid@example.com, not-an-email')

    const invalidRecipient = screen
      .getAllByRole('listitem')
      .find((item) => within(item).queryByText('not-an-email'))
    expect(invalidRecipient).toHaveAccessibleDescription(/members\.emailInvalid/i)
    expect(screen.getByText(/members\.emailInvalid/i)).toBeInTheDocument()
  })

  it('commits a recipient with Enter and removes the last one with Backspace', async () => {
    const user = userEvent.setup()
    render(<EmailRecipientsFieldWrapper />)

    const input = screen.getByRole('textbox', { name: /members\.emailRecipients/i })
    await user.type(input, 'person@example{Enter}')

    expect(screen.getByText('person@example')).toBeInTheDocument()
    expect(input).toHaveValue('')

    await user.type(input, '{Backspace}')
    expect(screen.queryByText('person@example')).not.toBeInTheDocument()
  })
})
