import type { ContactOption } from '@dify/contracts/api/console/workspaces/types.gen'
import { useRef, useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
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

beforeEach(async () => {
  onTestFinished(guardUnexpectedFetch())
  await page.viewport(1000, 700)
})

describe('recipient contact preview', () => {
  it('shows each bound IM provider once alongside Email with an accessible channel name', async () => {
    await render(
      <Harness
        target={{
          ...contact,
          im_providers: ['feishu', 'lark', 'slack', 'ding_talk', 'ms_teams', 'we_com', 'feishu'],
        }}
      />,
    )
    await page.getByRole('button', { name: 'Contact details' }).click()
    const dialog = page.getByRole('dialog', { name: contact.name })
    const channels = dialog.getByRole('group', { name: 'contacts.details.channels' })
    for (const name of [
      'contacts.directory.channel.email',
      'Feishu',
      'Lark',
      'Slack',
      'DingTalk',
      'Microsoft Teams',
      'WeCom',
    ]) {
      await expect.element(channels.getByRole('img', { name })).toBeVisible()
    }
    expect(channels.getByRole('img').all()).toHaveLength(7)
  })

  it('shows a bound IM channel even when the contact has no email', async () => {
    await render(<Harness target={{ ...contact, email: null, im_providers: ['feishu'] }} />)
    await page.getByRole('button', { name: 'Contact details' }).click()
    const dialog = page.getByRole('dialog', { name: contact.name })
    await expect.element(dialog.getByRole('img', { name: 'Feishu' })).toBeVisible()
    await expect
      .element(dialog.getByRole('img', { name: 'contacts.directory.channel.email' }))
      .not.toBeInTheDocument()
  })

  it('does not imply an IM binding for an email-only contact', async () => {
    await render(<Harness target={contact} />)
    await page.getByRole('button', { name: 'Contact details' }).click()
    const dialog = page.getByRole('dialog', { name: contact.name })
    await expect
      .element(dialog.getByRole('img', { name: 'contacts.directory.channel.email' }))
      .toBeVisible()
    expect(dialog.getByRole('img').all()).toHaveLength(1)
    await expect.element(dialog.getByRole('img', { name: 'Feishu' })).not.toBeInTheDocument()
  })

  it('does not display a channel when no email or IM provider is available', async () => {
    await render(<Harness target={{ ...contact, email: null }} />)
    await page.getByRole('button', { name: 'Contact details' }).click()
    const dialog = page.getByRole('dialog', { name: contact.name })
    await expect
      .element(dialog.getByRole('group', { name: 'contacts.details.channels' }))
      .not.toBeInTheDocument()
    await expect.element(dialog.getByRole('img')).not.toBeInTheDocument()
  })

  it('preserves the details trigger while its current contact becomes available or clears', async () => {
    const { rerender } = await render(<Harness />)
    const trigger = page.getByRole('button', { name: 'Contact details' })
    await expect.element(trigger).toBeDisabled()
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()

    await rerender(<Harness target={contact} />)
    await trigger.click()
    await expect.element(page.getByRole('dialog', { name: contact.name })).toBeVisible()

    await rerender(<Harness />)
    await expect.element(trigger).toBeDisabled()
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  })

  it('returns keyboard focus to the recipient input after closing details', async () => {
    await render(<Harness target={contact} />)
    await userEvent.tab()
    await userEvent.tab()
    await expect.element(page.getByRole('button', { name: 'Contact details' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect.element(page.getByRole('dialog', { name: contact.name })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
    await expect.element(page.getByRole('textbox', { name: 'Recipients' })).toHaveFocus()
  })

  it('keeps existing chip previews able to replace a conflicting contact', async () => {
    function ConflictOwner() {
      const [selected, setSelected] = useState<ContactOption>(contact)
      return (
        <>
          <output aria-label="Selected contact">{selected.name}</output>
          <RecipientContactPreview
            contact={organizationContact}
            conflictingContact={selected}
            onReplace={() => setSelected(organizationContact)}
          >
            <button type="button">Contact details</button>
          </RecipientContactPreview>
        </>
      )
    }
    await render(<ConflictOwner />)
    await page.getByRole('button', { name: 'Contact details' }).click()
    await expect.element(page.getByRole('dialog', { name: organizationContact.name })).toBeVisible()
    await page
      .getByRole('button', { name: 'workflow.nodes.humanInputV2.recipients.useThisInstead' })
      .click()
    await expect
      .element(page.getByRole('status', { name: 'Selected contact' }))
      .toHaveTextContent(organizationContact.name)
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  })
})
