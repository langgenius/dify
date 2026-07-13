import type { EmailRecipient } from '../email-recipients'
import { createEvent, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { EmailRecipientsField } from '../email-recipients-field'

function EmailRecipientsFieldWrapper({ disabled = false }: { disabled?: boolean }) {
  const [recipients, setRecipients] = useState<EmailRecipient[]>([])
  const [draft, setDraft] = useState('')

  return (
    <>
      <EmailRecipientsField
        recipients={recipients}
        draft={draft}
        onRecipientsChange={setRecipients}
        onDraftChange={setDraft}
        disabled={disabled}
      />
      <button type="button">Next control</button>
    </>
  )
}

function getRecipient(value: string) {
  const recipient = screen.getAllByRole('listitem').find((item) => within(item).queryByText(value))

  expect(recipient).toBeDefined()
  return recipient!
}

function getChip(value: string) {
  return screen.getByRole('button', { name: value })
}

describe('EmailRecipientsField', () => {
  it('describes how to add multiple email addresses', () => {
    render(<EmailRecipientsFieldWrapper />)

    const input = screen.getByRole('textbox', { name: /members\.emailRecipients/i })

    expect(input).toHaveAttribute('type', 'email')
    expect(input).toHaveAttribute('multiple')
    expect(input).toHaveAccessibleDescription(/members\.emailRecipientsTip/i)
  })

  it('keeps an uncommitted draft when focus leaves the composer', async () => {
    const user = userEvent.setup()
    render(<EmailRecipientsFieldWrapper />)

    const input = screen.getByRole('textbox', { name: /members\.emailRecipients/i })
    await user.type(input, 'draft@example.com')
    await user.tab()

    expect(input).toHaveValue('draft@example.com')
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next control' })).toHaveFocus()
  })

  it('commits a valid draft with Enter and keeps focus in the composer', async () => {
    const user = userEvent.setup()
    render(<EmailRecipientsFieldWrapper />)

    const input = screen.getByRole('textbox', { name: /members\.emailRecipients/i })
    await user.type(input, 'person@example{Enter}')

    expect(getRecipient('person@example')).toBeInTheDocument()
    expect(input).toHaveValue('')
    expect(input).toHaveFocus()
  })

  it('keeps a manually entered invalid address in the input for correction', async () => {
    const user = userEvent.setup()
    render(<EmailRecipientsFieldWrapper />)

    const input = screen.getByRole('textbox', { name: /members\.emailRecipients/i })
    await user.type(input, 'not-an-email{Enter}')

    expect(input).toHaveValue('not-an-email')
    expect(input).toHaveFocus()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(screen.getByText(/members\.emailInvalid/i)).toBeInTheDocument()
  })

  it('does not commit or submit Enter while an IME composition is active', async () => {
    const user = userEvent.setup()
    render(<EmailRecipientsFieldWrapper />)

    const input = screen.getByRole('textbox', { name: /members\.emailRecipients/i })
    await user.type(input, 'person@example.com')
    const enter = createEvent.keyDown(input, { key: 'Enter', isComposing: true })
    fireEvent(input, enter)

    expect(enter).toHaveProperty('defaultPrevented', true)
    expect(input).toHaveValue('person@example.com')
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('parses batch paste delimiters and removes duplicates case-insensitively', async () => {
    const user = userEvent.setup()
    render(<EmailRecipientsFieldWrapper />)

    const input = screen.getByRole('textbox', { name: /members\.emailRecipients/i })
    await user.click(input)
    await user.paste(
      'First@Example.com, second@example.com; FIRST@example.com\nthird@example.com\tfourth@example.com',
    )

    const recipientList = screen.getByRole('list', { name: /members\.emailRecipients/i })
    expect(within(recipientList).getAllByRole('listitem')).toHaveLength(4)
    expect(within(recipientList).getByText('first@example.com')).toBeInTheDocument()
    expect(within(recipientList).getByText('second@example.com')).toBeInTheDocument()
    expect(within(recipientList).getByText('third@example.com')).toBeInTheDocument()
    expect(within(recipientList).getByText('fourth@example.com')).toBeInTheDocument()
  })

  it('moves an invalid pasted address back into the input for editing', async () => {
    const user = userEvent.setup()
    render(<EmailRecipientsFieldWrapper />)

    const input = screen.getByRole('textbox', { name: /members\.emailRecipients/i })
    await user.click(input)
    await user.paste('valid@example.com, not-an-email')
    await user.click(screen.getByRole('button', { name: /operation\.edit.*not-an-email/i }))

    expect(screen.queryByText('not-an-email')).not.toBeInTheDocument()
    expect(input).toHaveValue('not-an-email')
    expect(input).toHaveFocus()
    expect(getRecipient('valid@example.com')).toBeInTheDocument()
  })

  it('preserves the draft and restores input focus when a recipient is removed', async () => {
    const user = userEvent.setup()
    render(<EmailRecipientsFieldWrapper />)

    const input = screen.getByRole('textbox', { name: /members\.emailRecipients/i })
    await user.type(input, 'existing@example.com{Enter}draft@example.com')
    await user.click(
      screen.getByRole('button', { name: /operation\.remove.*existing@example\.com/i }),
    )

    expect(screen.queryByText('existing@example.com')).not.toBeInTheDocument()
    expect(input).toHaveValue('draft@example.com')
    expect(input).toHaveFocus()
  })

  it('supports one keyboard path through chips without adding tab stops', async () => {
    const user = userEvent.setup()
    render(<EmailRecipientsFieldWrapper />)

    const input = screen.getByRole('textbox', { name: /members\.emailRecipients/i })
    await user.click(input)
    await user.paste('first@example.com, second@example.com')

    await user.keyboard('{ArrowLeft}')
    expect(getChip('second@example.com')).toHaveFocus()

    await user.keyboard('{ArrowLeft}')
    expect(getChip('first@example.com')).toHaveFocus()

    await user.keyboard('{ArrowRight}{Delete}')
    expect(screen.queryByText('second@example.com')).not.toBeInTheDocument()
    expect(getChip('first@example.com')).toHaveFocus()

    await user.keyboard('{Backspace}')
    expect(screen.queryByText('first@example.com')).not.toBeInTheDocument()
    expect(input).toHaveFocus()

    await user.type(input, 'last@example.com{Enter}')
    await user.tab()
    expect(screen.getByRole('button', { name: 'Next control' })).toHaveFocus()
  })

  it('immediately removes the last chip with Backspace from an empty input', async () => {
    const user = userEvent.setup()
    render(<EmailRecipientsFieldWrapper />)

    const input = screen.getByRole('textbox', { name: /members\.emailRecipients/i })
    await user.type(input, 'person@example.com{Enter}{Backspace}')

    expect(screen.queryByText('person@example.com')).not.toBeInTheDocument()
    expect(input).toHaveFocus()
  })

  it('disables every editing action while the composer is frozen', () => {
    render(<EmailRecipientsFieldWrapper disabled />)

    expect(screen.getByRole('textbox', { name: /members\.emailRecipients/i })).toBeDisabled()
  })
})
