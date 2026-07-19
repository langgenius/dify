import type { ContactRecipientOption, ContactRecipientOptionProvider } from '../contact-provider'
import type { HumanInputV2Recipient } from '../types'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import Recipients from '../components/recipients'

vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-reference-picker', () => ({
  __esModule: true,
  default: (props: { onChange: (value: string[]) => void }) => (
    <button
      type="button"
      aria-label="insert-dynamic-recipient"
      onClick={() => props.onChange(['start', 'owner_email'])}
    />
  ),
}))

const contact: ContactRecipientOption = {
  id: 'contact-evan',
  name: 'Evan Zhang',
  email: 'evan@example.com',
  source: 'workspace',
}

const organizationContact: ContactRecipientOption = {
  id: 'contact-amanda',
  name: 'Amanda Lin',
  email: 'amanda@example.com',
  source: 'organization',
}

const provider = (overrides: Partial<ContactRecipientOptionProvider> = {}) => ({
  search: vi.fn(async () => [contact]),
  resolve: vi.fn(async (ids: string[]) => (ids.includes(contact.id) ? [contact] : [])),
  ...overrides,
})

const Harness = ({
  initial = [],
  optionProvider = provider(),
  readonly = false,
  observe,
}: {
  initial?: HumanInputV2Recipient[]
  optionProvider?: ContactRecipientOptionProvider
  readonly?: boolean
  observe?: (value: HumanInputV2Recipient[]) => void
}) => {
  const [value, setValue] = useState(initial)
  return (
    <Recipients
      nodeId="human-input-v2"
      value={value}
      provider={optionProvider}
      readonly={readonly}
      onChange={(nextValue) => {
        setValue(nextValue)
        observe?.(nextValue)
      }}
    />
  )
}

describe('Human Input v2 Recipients', () => {
  it('adds Contact, one-time email, Dynamic Email and Initiator in order', async () => {
    const user = userEvent.setup()
    const observe = vi.fn()
    render(<Harness observe={observe} />)

    const emailInput = screen.getByLabelText('workflow.nodes.humanInputV2.recipients.emailLabel')
    await user.type(emailInput, 'owner@example.com{Enter}')
    await user.click(
      screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.recipients.addContact' }),
    )
    await user.click(await screen.findByText('Evan Zhang'))
    await user.click(screen.getByRole('button', { name: 'insert-dynamic-recipient' }))
    await user.click(
      screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.recipients.addContact' }),
    )
    await user.click(
      screen.getByRole('button', {
        name: 'workflow.nodes.humanInputV2.recipients.initiator',
      }),
    )

    expect(observe).toHaveBeenLastCalledWith([
      { type: 'onetime_email', email: 'owner@example.com' },
      { type: 'contact', contact_id: 'contact-evan' },
      { type: 'dynamic_email', selector: ['start', 'owner_email'] },
      { type: 'initiator' },
    ])
  })

  it('prevents canonical email duplicates and preserves imported duplicate rows', async () => {
    const user = userEvent.setup()
    const observe = vi.fn()
    render(
      <Harness
        initial={[
          { type: 'initiator' },
          { type: 'initiator' },
          { type: 'onetime_email', email: 'owner@example.com' },
        ]}
        observe={observe}
      />,
    )

    expect(screen.getAllByText('workflow.nodes.humanInputV2.error.recipientInvalid')).toHaveLength(
      1,
    )
    await user.type(
      screen.getByLabelText('workflow.nodes.humanInputV2.recipients.emailLabel'),
      'OWNER@example.com{Enter}',
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      'workflow.nodes.humanInputV2.recipients.emailInvalidOrDuplicate',
    )
    expect(observe).not.toHaveBeenCalled()
  })

  it('renders deterministic loading, empty and error provider states', async () => {
    const user = userEvent.setup()
    let resolveSearch: (value: ContactRecipientOption[]) => void = () => undefined
    const loadingProvider = provider({
      search: vi.fn(
        () =>
          new Promise<ContactRecipientOption[]>((resolve) => {
            resolveSearch = resolve
          }),
      ),
    })
    const { unmount } = render(<Harness optionProvider={loadingProvider} />)
    await user.click(
      screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.recipients.addContact' }),
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      'workflow.nodes.humanInputV2.recipients.loading',
    )
    resolveSearch([])
    expect(
      await screen.findByText('workflow.nodes.humanInputV2.recipients.noResults'),
    ).toBeInTheDocument()
    unmount()

    render(
      <Harness
        optionProvider={provider({ search: vi.fn(async () => Promise.reject(new Error('mock'))) })}
      />,
    )
    await user.click(
      screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.recipients.addContact' }),
    )
    expect(
      await screen.findByText('workflow.nodes.humanInputV2.recipients.loadError'),
    ).toBeInTheDocument()
  })

  it('filters Contact results with the Figma source tabs', async () => {
    const user = userEvent.setup()
    render(
      <Harness
        optionProvider={provider({
          search: vi.fn(async () => [contact, organizationContact]),
        })}
      />,
    )

    await user.click(
      screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.recipients.addContact' }),
    )
    expect(await screen.findByText('Evan Zhang')).toBeInTheDocument()
    await user.click(
      screen.getByRole('tab', {
        name: 'workflow.nodes.humanInputV2.recipients.contactSource.organization',
      }),
    )

    expect(screen.queryByText('Evan Zhang')).not.toBeInTheDocument()
    expect(screen.getByText('Amanda Lin')).toBeInTheDocument()
  })

  it('resolves stored contacts and removes nothing in read-only mode', async () => {
    const observe = vi.fn()
    render(
      <Harness
        initial={[{ type: 'contact', contact_id: 'contact-evan' }]}
        observe={observe}
        readonly
      />,
    )

    await waitFor(() =>
      expect(screen.getByText('Evan Zhang · evan@example.com')).toBeInTheDocument(),
    )
    expect(
      screen.queryByRole('button', { name: 'workflow.nodes.humanInputV2.recipients.addContact' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByLabelText(/workflow\.nodes\.humanInputV2\.recipients\.remove/),
    ).not.toBeInTheDocument()
    expect(observe).not.toHaveBeenCalled()
  })

  it('keeps local edits out of DSL until confirm and resets type-specific draft fields', async () => {
    const user = userEvent.setup()
    const observe = vi.fn()
    render(<Harness initial={[{ type: 'onetime_email', email: 'invalid' }]} observe={observe} />)

    await user.click(
      screen.getByRole('button', { name: /workflow\.nodes\.humanInputV2\.recipients\.edit/ }),
    )
    await user.click(
      screen.getByRole('button', {
        name: 'workflow.nodes.humanInputV2.recipients.type.initiator',
      }),
    )
    await user.click(
      screen.getAllByRole('button', {
        name: 'workflow.nodes.humanInputV2.recipients.cancel',
      })[0]!,
    )
    expect(observe).not.toHaveBeenCalled()

    await user.click(
      screen.getByRole('button', { name: /workflow\.nodes\.humanInputV2\.recipients\.edit/ }),
    )
    await user.click(
      screen.getByRole('button', {
        name: 'workflow.nodes.humanInputV2.recipients.type.initiator',
      }),
    )
    await user.click(
      screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.recipients.confirm' }),
    )

    expect(observe).toHaveBeenLastCalledWith([{ type: 'initiator' }])
  })

  it('repairs an unresolved imported contact in place without reordering', async () => {
    const user = userEvent.setup()
    const observe = vi.fn()
    render(
      <Harness
        initial={[
          { type: 'initiator' },
          { type: 'contact', contact_id: 'missing-contact' },
          { type: 'onetime_email', email: 'owner@example.com' },
        ]}
        observe={observe}
      />,
    )

    await user.click(
      screen.getByRole('button', {
        name: /workflow\.nodes\.humanInputV2\.recipients\.edit:.*missing-contact/,
      }),
    )
    await user.click(await screen.findByText('Evan Zhang · evan@example.com'))
    await user.click(
      screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.recipients.confirm' }),
    )

    expect(observe).toHaveBeenLastCalledWith([
      { type: 'initiator' },
      { type: 'contact', contact_id: 'contact-evan' },
      { type: 'onetime_email', email: 'owner@example.com' },
    ])
  })
})
