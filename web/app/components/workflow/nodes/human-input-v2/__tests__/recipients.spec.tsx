import type {
  CurrentWorkspaceSummaryResponse,
  ListContactOptionsResponse,
  ListContactsResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { ContactRecipientOption, ContactRecipientOptionProvider } from '../contact-provider'
import type { HumanInputV2Recipient } from '../types'
import type { Node } from '@/app/components/workflow/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider as JotaiProvider } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import { useState } from 'react'
import { BlockEnum } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/client'
import Recipients from '../components/recipients'

const runtimeApi = vi.hoisted(() => ({
  summary: vi.fn<() => Promise<CurrentWorkspaceSummaryResponse>>(),
  contacts:
    vi.fn<
      (input: {
        query: { group: 'workspace'; page: number; limit: number }
      }) => Promise<ListContactsResponse>
    >(),
  options: vi.fn<() => Promise<ListContactOptionsResponse>>(),
}))

vi.mock('@/service/client', async () => {
  const { createTanstackQueryUtils } = await import('@orpc/tanstack-query')
  return {
    consoleQuery: createTanstackQueryUtils({
      workspaces: {
        current: {
          summary: { get: runtimeApi.summary },
          humanInput: {
            contacts: { get: runtimeApi.contacts },
            contactOptions: { get: runtimeApi.options },
          },
        },
      },
    }),
  }
})

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
  resolve: vi.fn(async ({ contact_ids }: { contact_ids: string[] }) =>
    contact_ids.includes(contact.id) ? [contact] : [],
  ),
  ...overrides,
})

const Harness = ({
  initial = [],
  optionProvider = provider(),
  readonly = false,
  observe,
  availableNodes,
}: {
  initial?: HumanInputV2Recipient[]
  optionProvider?: ContactRecipientOptionProvider
  readonly?: boolean
  observe?: (value: HumanInputV2Recipient[]) => void
  availableNodes?: Node[]
}) => {
  const [value, setValue] = useState(initial)
  return (
    <Recipients
      nodeId="human-input-v2"
      value={value}
      provider={optionProvider}
      availableNodes={availableNodes}
      readonly={readonly}
      onChange={(nextValue) => {
        setValue(nextValue)
        observe?.(nextValue)
      }}
    />
  )
}

describe('Human Input v2 Recipients', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runtimeApi.contacts.mockResolvedValue({ data: [], total: 7, page: 1, limit: 1 })
    runtimeApi.options.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 })
  })

  it('searches and selects real contacts directly from the main recipient input', async () => {
    const user = userEvent.setup()
    const observe = vi.fn()
    const optionProvider = provider()
    render(<Harness optionProvider={optionProvider} observe={observe} />)

    const input = screen.getByLabelText('workflow.nodes.humanInputV2.recipients.placeholder')
    await user.type(input, 'Evan')
    expect(optionProvider.search).toHaveBeenLastCalledWith('Evan')
    expect(input).toHaveFocus()
    await user.click(await screen.findByRole('button', { name: 'Evan Zhang · evan@example.com' }))

    expect(observe).toHaveBeenLastCalledWith([{ type: 'contact', contact_id: contact.id }])
    expect(input).toHaveValue('')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('uses Enter to choose a matching contact name instead of reporting an invalid email', async () => {
    const user = userEvent.setup()
    const observe = vi.fn()
    render(<Harness observe={observe} />)

    await user.type(
      screen.getByLabelText('workflow.nodes.humanInputV2.recipients.placeholder'),
      'Evan',
    )
    await screen.findByRole('button', { name: 'Evan Zhang · evan@example.com' })
    await user.keyboard('{Enter}')

    expect(observe).toHaveBeenLastCalledWith([{ type: 'contact', contact_id: contact.id }])
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not add a previous search result when Enter is pressed after clearing the input', async () => {
    const user = userEvent.setup()
    const observe = vi.fn()
    render(<Harness observe={observe} />)
    const input = screen.getByLabelText('workflow.nodes.humanInputV2.recipients.placeholder')

    await user.type(input, 'Evan')
    await screen.findByRole('button', { name: 'Evan Zhang · evan@example.com' })
    await user.clear(input)
    await user.keyboard('{Enter}')

    expect(observe).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('only selects a result from the active source filter when Enter is pressed in the main input', async () => {
    const user = userEvent.setup()
    const observe = vi.fn()
    render(
      <Harness
        observe={observe}
        optionProvider={provider({ search: vi.fn(async () => [contact, organizationContact]) })}
      />,
    )
    const input = screen.getByLabelText('workflow.nodes.humanInputV2.recipients.placeholder')
    await user.type(input, 'a')
    await screen.findByRole('button', { name: 'Evan Zhang · evan@example.com' })
    await user.click(
      screen.getByRole('tab', {
        name: 'workflow.nodes.humanInputV2.recipients.contactSource.organization',
      }),
    )
    expect(
      screen.queryByRole('button', { name: 'Evan Zhang · evan@example.com' }),
    ).not.toBeInTheDocument()
    act(() => input.focus())
    await user.keyboard('{Enter}')

    expect(observe).toHaveBeenLastCalledWith([
      { type: 'contact', contact_id: organizationContact.id },
    ])
  })

  it('keeps the selected contact label while pending but removes it when the server cannot resolve it', async () => {
    const user = userEvent.setup()
    let finishResolve: (options: ContactRecipientOption[]) => void = () => undefined
    const resolve = vi.fn(
      () =>
        new Promise<ContactRecipientOption[]>((finish) => {
          finishResolve = finish
        }),
    )
    render(<Harness optionProvider={provider({ resolve })} />)
    await user.type(
      screen.getByLabelText('workflow.nodes.humanInputV2.recipients.placeholder'),
      'Evan',
    )
    await user.click(await screen.findByRole('button', { name: 'Evan Zhang · evan@example.com' }))

    expect(
      screen.getByRole('button', { name: 'Evan Zhang · evan@example.com' }),
    ).toBeInTheDocument()
    expect(screen.queryByText(contact.id)).not.toBeInTheDocument()
    await act(async () => finishResolve([]))
    expect(
      screen.queryByRole('button', { name: 'Evan Zhang · evan@example.com' }),
    ).not.toBeInTheDocument()
    expect(screen.getByText(contact.id)).toBeInTheDocument()
  })

  it('discards a previously resolved contact after a later successful response omits it', async () => {
    const resolve = vi.fn().mockResolvedValueOnce([contact]).mockResolvedValueOnce([])
    const optionProvider = provider({ resolve })
    const recipients: HumanInputV2Recipient[] = [{ type: 'contact', contact_id: contact.id }]
    const { rerender } = render(
      <Recipients
        nodeId="human-input-v2"
        value={recipients}
        provider={optionProvider}
        readonly={false}
        onChange={vi.fn()}
      />,
    )
    await screen.findByRole('button', { name: 'Evan Zhang · evan@example.com' })

    rerender(
      <Recipients
        nodeId="human-input-v2"
        value={[...recipients, { type: 'initiator' }]}
        provider={optionProvider}
        readonly={false}
        onChange={vi.fn()}
      />,
    )

    await waitFor(() =>
      expect(
        screen.queryByRole('button', {
          name: 'Evan Zhang · evan@example.com',
        }),
      ).not.toBeInTheDocument(),
    )
    expect(screen.getByText(contact.id)).toBeInTheDocument()
  })

  it('does not select a recipient while confirming an IME composition', async () => {
    const user = userEvent.setup()
    const observe = vi.fn()
    render(<Harness observe={observe} />)
    const input = screen.getByLabelText('workflow.nodes.humanInputV2.recipients.placeholder')
    await user.type(input, 'Evan')
    await screen.findByRole('button', { name: 'Evan Zhang · evan@example.com' })

    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(observe).not.toHaveBeenCalled()
    expect(input).toHaveValue('Evan')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('displays and updates the node title for a dynamic recipient instead of its internal id', () => {
    const source: Node = {
      id: 'node-17290001',
      position: { x: 0, y: 0 },
      data: { type: BlockEnum.Start, title: 'Request details', desc: '' },
    }
    const initial: HumanInputV2Recipient[] = [
      { type: 'dynamic_email', selector: [source.id, 'owner_email'] },
    ]
    const { rerender } = render(<Harness initial={initial} availableNodes={[source]} readonly />)

    expect(screen.getByText('Request details')).toBeInTheDocument()
    expect(screen.getByText('owner_email')).toBeInTheDocument()
    expect(screen.queryByText(/node-17290001/)).not.toBeInTheDocument()
    rerender(
      <Harness
        initial={initial}
        availableNodes={[{ ...source, data: { ...source.data, title: 'Requester' } }]}
        readonly
      />,
    )
    expect(screen.getByText('Requester')).toBeInTheDocument()
    expect(screen.queryByText('Request details')).not.toBeInTheDocument()
  })

  it('shows the source node in the dynamic recipient editor and preserves the selector on save', async () => {
    const user = userEvent.setup()
    const observe = vi.fn()
    const source: Node = {
      id: '1790152799766',
      position: { x: 0, y: 0 },
      data: { type: BlockEnum.Start, title: 'Start', desc: '' },
    }
    const initial: HumanInputV2Recipient[] = [
      { type: 'dynamic_email', selector: [source.id, 'email'] },
    ]
    const { rerender } = render(
      <Harness initial={initial} availableNodes={[source]} observe={observe} />,
    )

    await user.click(screen.getByRole('button', { name: /recipients\.edit:.*Start \/ email/ }))
    const editor = screen.getByRole('group', {
      name: 'workflow.nodes.humanInputV2.recipients.editRecipient',
    })
    expect(within(editor).getByText('Start')).toBeInTheDocument()
    expect(within(editor).getByText('email')).toBeInTheDocument()
    expect(within(editor).queryByText(/1790152799766/)).not.toBeInTheDocument()

    rerender(
      <Harness
        initial={initial}
        availableNodes={[{ ...source, data: { ...source.data, title: 'User input' } }]}
        observe={observe}
      />,
    )
    expect(within(editor).getByText('User input')).toBeInTheDocument()
    expect(within(editor).queryByText('Start')).not.toBeInTheDocument()
    await user.click(
      within(editor).getByRole('button', {
        name: 'workflow.nodes.humanInputV2.recipients.confirm',
      }),
    )
    expect(observe).toHaveBeenLastCalledWith(initial)
  })

  it.each(['owner', 'editor'] as const)(
    'shows the actual workspace and respects the %s permission boundary for its contact count',
    async (role) => {
      const user = userEvent.setup()
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: Infinity } },
      })
      queryClient.setQueryData(consoleQuery.workspaces.current.summary.get.queryKey(), {
        id: 'workspace-current',
        name: 'Actual workspace',
        role,
        plan: null,
        credits: null,
      } satisfies CurrentWorkspaceSummaryResponse)
      const store = createStore()
      store.set(queryClientAtom, queryClient)
      render(
        <JotaiProvider store={store}>
          <QueryClientProvider client={queryClient}>
            <Recipients nodeId="runtime-node" value={[]} onChange={vi.fn()} readonly={false} />
          </QueryClientProvider>
        </JotaiProvider>,
      )

      await user.click(
        screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.recipients.addContact' }),
      )
      const workspaceOption = await screen.findByRole('button', {
        name: 'workflow.nodes.humanInputV2.recipients.allWorkspaceContacts',
      })
      expect(workspaceOption).toHaveTextContent('Actual workspace')
      if (role === 'owner') {
        expect(await within(workspaceOption).findByText('7')).toBeInTheDocument()
        expect(runtimeApi.contacts.mock.calls[0]?.[0]).toEqual({
          query: { group: 'workspace', page: 1, limit: 1 },
        })
      } else {
        expect(runtimeApi.contacts).not.toHaveBeenCalled()
        expect(within(workspaceOption).queryByText('7')).not.toBeInTheDocument()
      }
    },
  )

  it('discloses the full selected contact on hover and keyboard activation without changing readonly recipients', async () => {
    const user = userEvent.setup()
    const observe = vi.fn()
    render(
      <Harness
        initial={[{ type: 'contact', contact_id: contact.id }]}
        readonly
        observe={observe}
      />,
    )

    const trigger = await screen.findByRole('button', { name: 'Evan Zhang · evan@example.com' })
    await user.hover(trigger)
    const preview = await screen.findByRole('dialog', { name: contact.name })
    expect(within(preview).getByText(contact.email)).toBeInTheDocument()
    expect(
      within(preview).getByText('workflow.nodes.humanInputV2.recipients.contactSource.workspace'),
    ).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: contact.name })).not.toBeInTheDocument(),
    )

    act(() => trigger.focus())
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('dialog', { name: contact.name })).toBeInTheDocument()
    expect(observe).not.toHaveBeenCalled()
  })

  it('previews a contact without selecting it and preserves the picker selection action', async () => {
    const user = userEvent.setup()
    const observe = vi.fn()
    render(<Harness observe={observe} />)

    await user.click(
      screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.recipients.addContact' }),
    )
    const row = await screen.findByRole('button', { name: 'Evan Zhang · evan@example.com' })
    await user.hover(row)
    expect(await screen.findByRole('dialog', { name: contact.name })).toHaveTextContent(
      contact.email,
    )
    expect(observe).not.toHaveBeenCalled()

    await user.click(row)
    expect(observe).toHaveBeenLastCalledWith([{ type: 'contact', contact_id: contact.id }])
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: contact.name })).not.toBeInTheDocument(),
    )
  })

  it('loads later contact pages without losing already loaded recipients', async () => {
    const user = userEvent.setup()
    const searchPage = vi
      .fn()
      .mockResolvedValueOnce({ data: [contact], page: 1, hasMore: true })
      .mockResolvedValueOnce({ data: [organizationContact], page: 2, hasMore: false })
    render(<Harness optionProvider={provider({ searchPage })} />)

    await user.click(
      screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.recipients.addContact' }),
    )
    expect(await screen.findByText('Evan Zhang')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'workflow.common.loadMore' }))

    expect(await screen.findByText('Amanda Lin')).toBeInTheDocument()
    expect(screen.getByText('Evan Zhang')).toBeInTheDocument()
    expect(searchPage).toHaveBeenLastCalledWith('', 2)
    expect(
      screen.queryByRole('button', { name: 'workflow.common.loadMore' }),
    ).not.toBeInTheDocument()
  })

  it('keeps the latest search results when an older response arrives last', async () => {
    const user = userEvent.setup()
    let finishInitial: (options: ContactRecipientOption[]) => void = () => undefined
    const search = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishInitial = resolve
          }),
      )
      .mockResolvedValue([organizationContact])
    render(<Harness optionProvider={provider({ search })} />)

    await user.click(
      screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.recipients.addContact' }),
    )
    await user.type(
      screen.getByRole('textbox', { name: 'workflow.nodes.humanInputV2.recipients.search' }),
      'Amanda',
    )
    expect(await screen.findByText('Amanda Lin')).toBeInTheDocument()
    await act(async () => {
      finishInitial([contact])
    })

    expect(screen.getByText('Amanda Lin')).toBeInTheDocument()
    expect(screen.queryByText('Evan Zhang')).not.toBeInTheDocument()
  })

  it('adds Contact, one-time email, Dynamic Email and Initiator in order', async () => {
    const user = userEvent.setup()
    const observe = vi.fn()
    render(<Harness observe={observe} />)

    const emailInput = screen.getByLabelText('workflow.nodes.humanInputV2.recipients.placeholder')
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
      screen.getByLabelText('workflow.nodes.humanInputV2.recipients.placeholder'),
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
    const optionProvider = provider()
    render(
      <Harness
        initial={[
          { type: 'contact', contact_id: 'contact-evan' },
          { type: 'contact', contact_id: 'contact-evan' },
        ]}
        optionProvider={optionProvider}
        observe={observe}
        readonly
      />,
    )

    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Evan Zhang · evan@example.com' })).toHaveLength(
        2,
      ),
    )
    expect(optionProvider.resolve).toHaveBeenCalledOnce()
    expect(optionProvider.resolve).toHaveBeenCalledWith({ contact_ids: ['contact-evan'] })
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

  it('renders a migrated whole-workspace recipient and preserves it while editing other recipients', async () => {
    const user = userEvent.setup()
    const observe = vi.fn()
    const optionProvider = provider()
    render(
      <Harness
        initial={[
          { type: 'all_workspace_contacts' },
          { type: 'onetime_email', email: 'before@example.com' },
        ]}
        optionProvider={optionProvider}
        observe={observe}
      />,
    )

    expect(
      screen.getByText('workflow.nodes.humanInputV2.recipients.allWorkspaceContacts'),
    ).toBeInTheDocument()
    expect(optionProvider.resolve).not.toHaveBeenCalled()
    expect(observe).not.toHaveBeenCalled()
    await user.click(
      screen.getByRole('button', { name: /recipients\.edit:.*allWorkspaceContacts/ }),
    )
    expect(
      screen.getByRole('button', {
        name: 'workflow.nodes.humanInputV2.recipients.type.all_workspace_contacts',
      }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(
      screen.getByText('workflow.nodes.humanInputV2.recipients.allWorkspaceContactsDescription'),
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.recipients.confirm' }),
    )
    expect(observe).toHaveBeenLastCalledWith([
      { type: 'all_workspace_contacts' },
      { type: 'onetime_email', email: 'before@example.com' },
    ])

    await user.click(screen.getByRole('button', { name: /recipients\.edit:.*before@example.com/ }))
    await user.click(
      screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.recipients.type.initiator' }),
    )
    await user.click(
      screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.recipients.confirm' }),
    )
    expect(observe).toHaveBeenLastCalledWith([
      { type: 'all_workspace_contacts' },
      { type: 'initiator' },
    ])
  })

  it('adds all workspace contacts once, rejects duplicate edits, and removes only that recipient', async () => {
    const user = userEvent.setup()
    const observe = vi.fn()
    render(<Harness initial={[{ type: 'initiator' }]} observe={observe} />)
    await user.click(
      screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.recipients.addContact' }),
    )
    await user.click(
      screen.getByRole('button', {
        name: 'workflow.nodes.humanInputV2.recipients.allWorkspaceContacts',
      }),
    )
    expect(observe).toHaveBeenLastCalledWith([
      { type: 'initiator' },
      { type: 'all_workspace_contacts' },
    ])
    await user.click(
      screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.recipients.addContact' }),
    )
    expect(
      screen.getByRole('button', {
        name: 'workflow.nodes.humanInputV2.recipients.allWorkspaceContacts',
      }),
    ).toBeDisabled()
    await user.keyboard('{Escape}')
    await user.click(
      screen.getByRole('button', { name: /recipients\.edit:.*recipients\.initiator/ }),
    )
    await user.click(
      screen.getByRole('button', {
        name: 'workflow.nodes.humanInputV2.recipients.type.all_workspace_contacts',
      }),
    )
    await user.click(
      screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.recipients.confirm' }),
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      'workflow.nodes.humanInputV2.error.recipientDuplicate',
    )
    expect(observe).toHaveBeenCalledTimes(1)
    await user.click(
      screen.getAllByRole('button', { name: 'workflow.nodes.humanInputV2.recipients.cancel' })[0]!,
    )
    await user.click(
      screen.getByRole('button', { name: /recipients\.remove:.*allWorkspaceContacts/ }),
    )
    expect(observe).toHaveBeenLastCalledWith([{ type: 'initiator' }])
  })
})
