import type { HumanInputV2Recipient } from '../types'
import { zGetFeaturesResponse } from '@dify/contracts/api/console/features/zod.gen'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import Recipients from '../components/recipients'
import {
  contact,
  contactApi,
  organizationContact,
  renderContactOwner,
  resetContactApi,
} from './fixtures/contact-api'

vi.mock('@/service/console', async () => ({
  consoleQuery: (await import('./fixtures/contact-api')).testConsoleQuery,
}))
vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-reference-picker', () => ({
  default: ({
    trigger,
    onChange,
  }: {
    trigger: React.ReactElement
    onChange: (value: string[]) => void
  }) => (
    <Popover>
      <PopoverTrigger render={trigger} />
      <PopoverContent>
        <button type="button" onClick={() => onChange(['start', 'owner_email'])}>
          Requester email
        </button>
      </PopoverContent>
    </Popover>
  ),
}))

const Harness = ({
  initial = [],
  readonly = false,
  observe = () => {},
}: {
  initial?: HumanInputV2Recipient[]
  readonly?: boolean
  observe?: (value: HumanInputV2Recipient[]) => void
}) => {
  const [value, setValue] = useState(initial)
  return (
    <Recipients
      nodeId="hitl"
      readonly={readonly}
      value={value}
      onChange={(next) => {
        setValue(next)
        observe(next)
      }}
    />
  )
}
const openPicker = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(
    await screen.findByRole('button', {
      name: 'workflow.nodes.humanInputV2.recipients.addContact',
    }),
  )
  return screen.findByRole('grid')
}
const field = () => screen.getByRole('combobox')
beforeEach(resetContactApi)

describe('recipient selection through generated queries', () => {
  it('adds a contact from a keyboard navigable listbox and removes the selected chip', async () => {
    const user = userEvent.setup(),
      observe = vi.fn()
    renderContactOwner(<Harness observe={observe} />)
    await openPicker(user)
    await screen.findByRole('gridcell', { name: /Evan Zhang/ })
    await user.click(screen.getByRole('gridcell', { name: /Evan Zhang/ }))
    expect(observe).toHaveBeenLastCalledWith([{ type: 'contact', contact_id: contact.id }])
    await user.click(await screen.findByRole('button', { name: /recipients.remove.*Evan Zhang/ }))
    expect(observe).toHaveBeenLastCalledWith([])
    expect(field()).toHaveFocus()
  })

  it.each([true, false])(
    'gates the platform source on authoritative features (%s)',
    async (enabled) => {
      contactApi.features.mockResolvedValue({
        ...zGetFeaturesResponse.parse({}),
        im_centrally_managed: enabled,
      })
      const user = userEvent.setup()
      renderContactOwner(<Harness />)
      await openPicker(user)
      await screen.findByRole('radio', {
        name: 'workflow.nodes.humanInputV2.recipients.contactSource.workspace',
      })
      await waitFor(() => expect(contactApi.features).toHaveBeenCalled())
      expect(screen.queryByRole('radio', { name: 'contacts.type.platform' }) !== null).toBe(enabled)
    },
  )

  it('does not fetch unbounded pages when a source has no matches in the current page', async () => {
    contactApi.options.mockImplementation(async ({ query }) => ({
      data: query.page === 1 ? [{ ...contact, type: 'external' as const }] : [contact],
      total: 40,
      page: query.page ?? 1,
      limit: 20,
    }))
    const user = userEvent.setup()
    renderContactOwner(<Harness />)
    await openPicker(user)
    await screen.findByRole('gridcell', { name: /Evan Zhang/ })
    await user.click(
      screen.getByRole('radio', {
        name: 'workflow.nodes.humanInputV2.recipients.contactSource.workspace',
      }),
    )
    expect(contactApi.options).toHaveBeenCalledTimes(1)
    const more = screen.getByRole('button', { name: 'workflow.common.loadMore' })
    await user.click(more)
    expect(await screen.findByRole('gridcell', { name: /Evan Zhang/ })).toBeVisible()
    await waitFor(() => expect(more).toHaveAttribute('aria-disabled', 'true'))
    expect(more).toHaveFocus()
    expect(contactApi.options).toHaveBeenCalledTimes(2)
  })

  it('searches remotely without reusing stale results for a new query', async () => {
    const user = userEvent.setup()
    contactApi.options.mockImplementation(async ({ query }) => ({
      data: query.keyword?.includes('amanda') ? [organizationContact] : [contact],
      total: 1,
      page: 1,
      limit: 20,
    }))
    renderContactOwner(<Harness />)
    await user.type(await screen.findByRole('combobox'), 'amanda')
    expect(await screen.findByRole('gridcell', { name: /Amanda Lin/ })).toBeVisible()
    expect(screen.queryByRole('gridcell', { name: /Evan Zhang/ })).not.toBeInTheDocument()
    expect(
      contactApi.options.mock.calls.every(
        ([input]) => !input.query.keyword || input.query.keyword === 'amanda',
      ),
    ).toBe(true)
  })

  it('keeps the picker recoverable after a failed search', async () => {
    const user = userEvent.setup()
    contactApi.options.mockRejectedValueOnce(new Error('unavailable'))
    renderContactOwner(<Harness />)
    await openPicker(user)
    await user.click(await screen.findByRole('button', { name: 'common.operation.retry' }))
    expect(await screen.findByRole('gridcell', { name: /Evan Zhang/ })).toBeVisible()
  })

  it.each(['one@example.com', 'one@example.com, two@example.com'])(
    'adds valid one-time email input %s',
    async (input) => {
      contactApi.options.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 })
      const user = userEvent.setup(),
        observe = vi.fn()
      renderContactOwner(<Harness observe={observe} />)
      await user.type(await screen.findByRole('combobox'), input)
      await user.click(
        await screen.findByRole('button', {
          name: 'workflow.nodes.humanInputV2.recipients.addEmail',
        }),
      )
      expect(observe).toHaveBeenLastCalledWith(
        input.split(',').map((email) => ({ type: 'onetime_email', email: email.trim() })),
      )
      await waitFor(() => expect(field()).toHaveFocus())
    },
  )

  it.each(['john..doe@example.com', 'same@example.com, SAME@example.com'])(
    'rejects invalid or duplicated email input %s',
    async (input) => {
      contactApi.options.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 })
      const user = userEvent.setup(),
        observe = vi.fn()
      renderContactOwner(<Harness observe={observe} />)
      await user.type(await screen.findByRole('combobox'), input)
      await user.click(
        screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.recipients.addEmail' }),
      )
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'workflow.nodes.humanInputV2.recipients.emailInvalidOrDuplicate',
      )
      expect(field()).toHaveAttribute('aria-invalid', 'true')
      expect(observe).not.toHaveBeenCalled()
    },
  )

  it('ignores Enter while Safari reports an unfinished composition', async () => {
    const observe = vi.fn()
    renderContactOwner(<Harness observe={observe} />)
    const input = await screen.findByRole('combobox')
    fireEvent.change(input, { target: { value: 'one@example.com' } })
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
    expect(observe).not.toHaveBeenCalled()
  })

  it('opens variable selection with slash and preserves other recipient types', async () => {
    const user = userEvent.setup(),
      observe = vi.fn()
    renderContactOwner(<Harness initial={[{ type: 'initiator' }]} observe={observe} />)
    await user.click(await screen.findByRole('combobox'))
    await user.keyboard('/')
    await user.click(await screen.findByRole('button', { name: 'Requester email' }))
    expect(observe).toHaveBeenLastCalledWith([
      { type: 'initiator' },
      { type: 'dynamic_email', selector: ['start', 'owner_email'] },
    ])
  })

  it('shows contact details through an explicit keyboard/touch action', async () => {
    const user = userEvent.setup()
    renderContactOwner(<Harness initial={[{ type: 'contact', contact_id: contact.id }]} />)
    const info = await screen.findByRole('button', { name: /recipients.contactInfo.*Evan Zhang/ })
    await user.click(info)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(contact.email)).toBeVisible()
  })

  it('keeps configured contact chips neutral while lookup is pending or fails', async () => {
    let fail!: (error: Error) => void
    contactApi.batch.mockImplementation(
      () =>
        new Promise((_, reject) => {
          fail = reject
        }),
    )
    renderContactOwner(<Harness initial={[{ type: 'contact', contact_id: contact.id }]} />)
    await waitFor(() => expect(contactApi.batch).toHaveBeenCalled())
    expect(
      screen.queryByText('workflow.nodes.humanInputV2.error.recipientInvalid'),
    ).not.toBeInTheDocument()
    await act(async () => fail(new Error('offline')))
    expect(
      screen.queryByText('workflow.nodes.humanInputV2.error.recipientInvalid'),
    ).not.toBeInTheDocument()
  })

  it('marks an authoritatively deleted contact invalid without dropping the configured recipient', async () => {
    const observe = vi.fn()
    contactApi.batch.mockResolvedValue({ data: [] })
    renderContactOwner(
      <Harness initial={[{ type: 'contact', contact_id: 'deleted' }]} observe={observe} />,
    )
    expect(
      await screen.findByText('workflow.nodes.humanInputV2.error.recipientInvalid'),
    ).toBeInTheDocument()
    expect(observe).not.toHaveBeenCalled()
  })

  it.each(['owner', 'editor'] as const)(
    'only queries the manager contact count for %s',
    async (role) => {
      const user = userEvent.setup()
      renderContactOwner(<Harness />, role)
      await openPicker(user)
      await screen.findByRole('gridcell', { name: 'QA workspace' })
      if (role === 'owner') await waitFor(() => expect(contactApi.contacts).toHaveBeenCalled())
      else expect(contactApi.contacts).not.toHaveBeenCalled()
    },
  )

  it('preserves readonly recipients without editable actions', async () => {
    renderContactOwner(<Harness initial={[{ type: 'contact', contact_id: contact.id }]} readonly />)
    expect(await screen.findByText(contact.name)).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /recipients.remove/ })).not.toBeInTheDocument()
    expect(contactApi.options).not.toHaveBeenCalled()
  })
})

describe('recipient keyboard editing preserves existing behavior', () => {
  it('does not clear configured recipients with Escape, whether the popup is open or closed', async () => {
    const user = userEvent.setup(),
      observe = vi.fn()
    renderContactOwner(
      <Harness
        initial={[{ type: 'initiator' }, { type: 'onetime_email', email: 'keep@example.com' }]}
        observe={observe}
      />,
    )
    await user.click(await screen.findByRole('combobox'))
    await user.keyboard('{Escape}')
    await user.keyboard('{Escape}')
    expect(observe).not.toHaveBeenCalled()
    expect(
      screen.getByRole('button', { name: /recipients.remove.*keep@example.com/ }),
    ).toBeInTheDocument()
  })

  it('Backspace in an empty input immediately removes only the preceding recipient', async () => {
    const user = userEvent.setup(),
      observe = vi.fn()
    renderContactOwner(
      <Harness
        initial={[{ type: 'initiator' }, { type: 'onetime_email', email: 'last@example.com' }]}
        observe={observe}
      />,
    )
    await user.click(await screen.findByRole('combobox'))
    await user.keyboard('{Backspace}')
    expect(observe).toHaveBeenLastCalledWith([{ type: 'initiator' }])
    expect(field()).toHaveFocus()
  })

  it('retains text while deleting a character instead of deleting a recipient', async () => {
    const user = userEvent.setup(),
      observe = vi.fn()
    renderContactOwner(<Harness initial={[{ type: 'initiator' }]} observe={observe} />)
    await user.type(await screen.findByRole('combobox'), 'ab')
    await user.keyboard('{Backspace}')
    expect(field()).toHaveValue('a')
    expect(observe).not.toHaveBeenCalled()
  })

  it('selects the first matching contact on Enter without requiring a pointer click', async () => {
    const user = userEvent.setup(),
      observe = vi.fn()
    renderContactOwner(<Harness observe={observe} />)
    await user.type(await screen.findByRole('combobox'), 'Evan')
    await screen.findByRole('gridcell', { name: /Evan Zhang/ })
    await user.keyboard('{Enter}')
    expect(observe).toHaveBeenLastCalledWith([{ type: 'contact', contact_id: contact.id }])
  })

  it('does not commit an old search result when Enter is pressed during a new keyword debounce', async () => {
    const user = userEvent.setup(),
      observe = vi.fn()
    renderContactOwner(<Harness observe={observe} />)
    await openPicker(user)
    await screen.findByRole('gridcell', { name: /Evan Zhang/ })
    await user.type(field(), 'Amanda')
    expect(screen.queryByRole('gridcell', { name: /Evan Zhang/ })).not.toBeInTheDocument()
    await user.keyboard('{Enter}')
    expect(observe).not.toHaveBeenCalled()
    expect(
      contactApi.options.mock.calls.every(
        ([input]) => !input.query.keyword || input.query.keyword === 'Amanda',
      ),
    ).toBe(true)
  })

  it('replaces a conflicting source explicitly instead of adding the same email twice', async () => {
    contactApi.options.mockResolvedValue({
      data: [contact, { ...organizationContact, email: contact.email }],
      total: 2,
      page: 1,
      limit: 20,
    })
    const user = userEvent.setup(),
      observe = vi.fn()
    renderContactOwner(
      <Harness
        initial={[{ type: 'initiator' }, { type: 'contact', contact_id: contact.id }]}
        observe={observe}
      />,
    )
    await waitFor(() => expect(contactApi.batch).toHaveBeenCalled())
    await openPicker(user)
    const row = await screen.findByRole('gridcell', { name: /Amanda Lin/ })
    expect(row).toHaveAttribute('aria-disabled', 'true')
    await user.click(screen.getByRole('button', { name: /recipients.contactInfo.*Amanda Lin/ }))
    await user.click(
      await screen.findByRole('button', {
        name: 'workflow.nodes.humanInputV2.recipients.useThisInstead',
      }),
    )
    expect(observe).toHaveBeenLastCalledWith([
      { type: 'initiator' },
      { type: 'contact', contact_id: organizationContact.id },
    ])
  })
})
