import type { ContactOption } from '@dify/contracts/api/console/workspaces/types.gen'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef } from 'react'
import { RecipientContactPreview } from '../components/recipient-contact-preview'
import { contact, organizationContact } from './fixtures/contact-api'

function Harness({ target }: { target?: ContactOption }) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <>
      <input ref={inputRef} aria-label="Recipients" />
      <RecipientContactPreview contact={target} returnFocus={inputRef}>
        <button type="button" disabled={!target}>
          Contact details
        </button>
      </RecipientContactPreview>
    </>
  )
}

describe('recipient contact preview', () => {
  it('shows each bound IM provider once alongside Email with an accessible channel name', async () => {
    const user = userEvent.setup()
    render(
      <Harness
        target={{
          ...contact,
          im_providers: ['feishu', 'lark', 'slack', 'ding_talk', 'ms_teams', 'we_com', 'feishu'],
        }}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Contact details' }))
    const dialog = await screen.findByRole('dialog', { name: contact.name })
    const channels = within(dialog).getByRole('group', { name: 'contacts.details.channels' })
    for (const name of [
      'contacts.directory.channel.email',
      'Feishu',
      'Lark',
      'Slack',
      'DingTalk',
      'Microsoft Teams',
      'WeCom',
    ]) {
      expect(within(channels).getByRole('img', { name })).toBeVisible()
    }
    expect(within(channels).getAllByRole('img')).toHaveLength(7)
  })

  it('shows a bound IM channel even when the contact has no email', async () => {
    const user = userEvent.setup()
    render(<Harness target={{ ...contact, email: null, im_providers: ['feishu'] }} />)
    await user.click(screen.getByRole('button', { name: 'Contact details' }))
    const dialog = await screen.findByRole('dialog', { name: contact.name })
    expect(within(dialog).getByRole('img', { name: 'Feishu' })).toBeVisible()
    expect(
      within(dialog).queryByRole('img', { name: 'contacts.directory.channel.email' }),
    ).not.toBeInTheDocument()
  })

  it('does not imply an IM binding for an email-only contact', async () => {
    const user = userEvent.setup()
    render(<Harness target={contact} />)
    await user.click(screen.getByRole('button', { name: 'Contact details' }))
    const dialog = await screen.findByRole('dialog', { name: contact.name })
    expect(
      within(dialog).getByRole('img', { name: 'contacts.directory.channel.email' }),
    ).toBeVisible()
    expect(within(dialog).getAllByRole('img')).toHaveLength(1)
    expect(within(dialog).queryByRole('img', { name: 'Feishu' })).not.toBeInTheDocument()
  })

  it('does not display a channel when no email or IM provider is available', async () => {
    const user = userEvent.setup()
    render(<Harness target={{ ...contact, email: null }} />)
    await user.click(screen.getByRole('button', { name: 'Contact details' }))
    const dialog = await screen.findByRole('dialog', { name: contact.name })
    expect(
      within(dialog).queryByRole('group', { name: 'contacts.details.channels' }),
    ).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('img')).not.toBeInTheDocument()
  })

  it('preserves the details trigger while its current contact becomes available or clears', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Contact details' })
    expect(trigger).toBeDisabled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    rerender(<Harness target={contact} />)
    expect(screen.getByRole('button', { name: 'Contact details' })).toBe(trigger)
    await user.click(trigger)
    expect(await screen.findByRole('dialog', { name: contact.name })).toBeVisible()

    rerender(<Harness />)
    expect(screen.getByRole('button', { name: 'Contact details' })).toBe(trigger)
    expect(trigger).toBeDisabled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('returns keyboard focus to the recipient input after closing details', async () => {
    const user = userEvent.setup()
    render(<Harness target={contact} />)
    await user.tab()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Contact details' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('dialog', { name: contact.name })).toBeVisible()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('textbox', { name: 'Recipients' })).toHaveFocus()
  })

  it('keeps existing chip previews able to replace a conflicting contact', async () => {
    const user = userEvent.setup()
    const onReplace = vi.fn()
    render(
      <RecipientContactPreview
        contact={organizationContact}
        conflictingContact={contact}
        onReplace={onReplace}
      >
        <button type="button">Contact details</button>
      </RecipientContactPreview>,
    )
    await user.click(screen.getByRole('button', { name: 'Contact details' }))
    expect(await screen.findByRole('dialog', { name: organizationContact.name })).toBeVisible()
    await user.click(
      screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.recipients.useThisInstead' }),
    )
    expect(onReplace).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
