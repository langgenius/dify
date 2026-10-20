import type {
  CurrentWorkspaceSummaryResponse,
  ListContactOptionsResponse,
  ListContactsResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { ReactElement } from 'react'
import type { ContactRecipientOption, ContactRecipientOptionProvider } from '../contact-provider'
import type { HumanInputV2Recipient } from '../types'
import type { Node } from '@/app/components/workflow/types'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider as JotaiProvider } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import { useState } from 'react'
import { BlockEnum } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
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

vi.mock('@/service/console', async () => {
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
  default: function MockVarReferencePicker(props: {
    onChange: (value: string[]) => void
    trigger?: ReactElement
  }) {
    const [open, setOpen] = useState(false)
    const variable = (
      <button
        type="button"
        aria-label="insert-dynamic-recipient"
        onClick={() => {
          props.onChange(['start', 'owner_email'])
          setOpen(false)
        }}
      />
    )
    return props.trigger ? (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger render={props.trigger} />
        <PopoverContent>{variable}</PopoverContent>
      </Popover>
    ) : (
      variable
    )
  },
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

  it.each(['Evan', 'evan@example.com'])(
    'uses Enter to choose a matching contact before a one-time email: %s',
    async (query) => {
      const user = userEvent.setup()
      const observe = vi.fn()
      render(<Harness observe={observe} />)

      await user.type(
        screen.getByLabelText('workflow.nodes.humanInputV2.recipients.placeholder'),
        query,
      )
      await screen.findByRole('button', { name: 'Evan Zhang · evan@example.com' })
      await user.keyboard('{Enter}')

      expect(observe).toHaveBeenLastCalledWith([{ type: 'contact', contact_id: contact.id }])
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    },
  )

  it('adds comma-separated emails atomically while preserving existing recipients', async () => {
    const user = userEvent.setup()
    const observe = vi.fn()
    render(<Harness initial={[{ type: 'contact', contact_id: contact.id }]} observe={observe} />)
    const input = screen.getByLabelText('workflow.nodes.humanInputV2.recipients.placeholder')

    await user.type(input, 'first@example.com, Second@example.com{Enter}')

    expect(observe).toHaveBeenCalledExactlyOnceWith([
      { type: 'contact', contact_id: contact.id },
      { type: 'onetime_email', email: 'first@example.com' },
      { type: 'onetime_email', email: 'Second@example.com' },
    ])
    expect(input).toHaveValue('')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it.each([
    'first@example.com, invalid',
    'first@example.com, FIRST@example.com',
    'first@example.com, OWNER@example.com',
  ])(
    'keeps the entire comma-separated draft when an email is invalid or duplicated: %s',
    async (draft) => {
      const user = userEvent.setup()
      const observe = vi.fn()
      render(
        <Harness
          initial={[{ type: 'onetime_email', email: 'owner@example.com' }]}
          observe={observe}
        />,
      )
      const input = screen.getByLabelText('workflow.nodes.humanInputV2.recipients.placeholder')

      await user.type(input, draft)
      await user.click(
        screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.recipients.addEmail' }),
      )

      expect(screen.getByRole('alert')).toHaveTextContent(
        'workflow.nodes.humanInputV2.recipients.emailInvalidOrDuplicate',
      )
      expect(input).toHaveValue(draft)
      expect(observe).not.toHaveBeenCalled()
    },
  )

  it('opens variable insertion with slash only from an empty non-composing recipient input', async () => {
    const user = userEvent.setup()
    const observe = vi.fn()
    render(<Harness observe={observe} />)
    const input = screen.getByLabelText('workflow.nodes.humanInputV2.recipients.placeholder')

    await user.type(input, 'draft/')
    expect(
      screen.queryByRole('button', { name: 'insert-dynamic-recipient' }),
    ).not.toBeInTheDocument()
    await user.clear(input)
    fireEvent.keyDown(input, { key: '/', isComposing: true })
    expect(
      screen.queryByRole('button', { name: 'insert-dynamic-recipient' }),
    ).not.toBeInTheDocument()

    await user.keyboard('/')
    expect(input).toHaveValue('')
    await user.click(screen.getByRole('button', { name: 'insert-dynamic-recipient' }))
    expect(observe).toHaveBeenCalledExactlyOnceWith([
      { type: 'dynamic_email', selector: ['start', 'owner_email'] },
    ])
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
        name: 'contacts.type.platform',
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

  it('finds workspace contacts beyond a full external page when switching source tabs', async () => {
    const user = userEvent.setup()
    const externalContacts: ContactRecipientOption[] = Array.from({ length: 20 }, (_, index) => ({
      id: `external-${index}`,
      name: `External ${index}`,
      email: `external-${index}@example.com`,
      source: 'external',
    }))
    const searchPage = vi
      .fn()
      .mockResolvedValueOnce({ data: externalContacts, page: 1, hasMore: true })
      .mockResolvedValueOnce({ data: [contact], page: 2, hasMore: false })
    render(<Harness optionProvider={provider({ searchPage })} />)

    await user.click(
      screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.recipients.addContact' }),
    )
    await screen.findByRole('button', { name: 'External 0 · external-0@example.com' })
    await user.click(
      screen.getByRole('tab', {
        name: 'workflow.nodes.humanInputV2.recipients.contactSource.workspace',
      }),
    )

    expect(
      await screen.findByRole('button', { name: 'Evan Zhang · evan@example.com' }),
    ).toBeInTheDocument()
    expect(searchPage).toHaveBeenLastCalledWith('', 2)
    expect(
      screen.queryByRole('button', { name: 'workflow.common.loadMore' }),
    ).not.toBeInTheDocument()
  })

  it('keeps loaded sources and manual pagination after finding a filtered contact', async () => {
    const user = userEvent.setup()
    const laterContact = {
      ...contact,
      id: 'contact-jane',
      name: 'Jane Workspace',
      email: 'jane@example.com',
    }
    const searchPage = vi
      .fn()
      .mockResolvedValueOnce({ data: [organizationContact], page: 1, hasMore: true })
      .mockResolvedValueOnce({ data: [contact], page: 2, hasMore: true })
      .mockResolvedValueOnce({ data: [laterContact], page: 3, hasMore: false })
    render(<Harness optionProvider={provider({ searchPage })} />)

    await user.click(
      screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.recipients.addContact' }),
    )
    await screen.findByRole('button', { name: 'Amanda Lin · amanda@example.com' })
    await user.click(
      screen.getByRole('tab', {
        name: 'workflow.nodes.humanInputV2.recipients.contactSource.workspace',
      }),
    )
    await screen.findByRole('button', { name: 'Evan Zhang · evan@example.com' })
    expect(searchPage).toHaveBeenCalledTimes(2)

    await user.click(screen.getByRole('button', { name: 'workflow.common.loadMore' }))
    expect(
      await screen.findByRole('button', { name: 'Jane Workspace · jane@example.com' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Evan Zhang · evan@example.com' }),
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole('tab', {
        name: 'workflow.nodes.humanInputV2.recipients.contactSource.all',
      }),
    )
    expect(
      screen.getByRole('button', { name: 'Amanda Lin · amanda@example.com' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Evan Zhang · evan@example.com' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Jane Workspace · jane@example.com' }),
    ).toBeInTheDocument()
    expect(searchPage).toHaveBeenLastCalledWith('', 3)
  })

  it('checks remaining pages before showing an empty source and lets failed pages retry', async () => {
    const user = userEvent.setup()
    const searchPage = vi
      .fn()
      .mockResolvedValueOnce({ data: [organizationContact], page: 1, hasMore: true })
      .mockRejectedValueOnce(new Error('Page unavailable'))
      .mockResolvedValueOnce({ data: [], page: 2, hasMore: true })
      .mockResolvedValueOnce({ data: [organizationContact], page: 3, hasMore: false })
    render(<Harness optionProvider={provider({ searchPage })} />)

    await user.click(
      screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.recipients.addContact' }),
    )
    await screen.findByRole('button', { name: 'Amanda Lin · amanda@example.com' })
    await user.click(
      screen.getByRole('tab', {
        name: 'workflow.nodes.humanInputV2.recipients.contactSource.workspace',
      }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'workflow.nodes.humanInputV2.recipients.loadError',
    )
    expect(searchPage).toHaveBeenCalledTimes(2)
    expect(
      screen.queryByText('workflow.nodes.humanInputV2.recipients.noResults'),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'workflow.common.loadMore' }))
    expect(
      await screen.findByText('workflow.nodes.humanInputV2.recipients.noResults'),
    ).toBeInTheDocument()
    expect(searchPage.mock.calls.map(([, page]) => page)).toEqual([1, 2, 2, 3])
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'workflow.common.loadMore' }),
    ).not.toBeInTheDocument()
  })

  it('ignores an older filtered page after the search query changes', async () => {
    const user = userEvent.setup()
    let finishOldPage: (result: {
      data: ContactRecipientOption[]
      page: number
      hasMore: boolean
    }) => void = () => undefined
    const newContact = { ...contact, id: 'new-contact', name: 'Zoe Workspace' }
    const searchPage = vi.fn((query: string, page: number) => {
      if (query === 'Z') return Promise.resolve({ data: [newContact], page: 1, hasMore: false })
      if (page === 1)
        return Promise.resolve({ data: [organizationContact], page: 1, hasMore: true })
      return new Promise<{ data: ContactRecipientOption[]; page: number; hasMore: boolean }>(
        (resolve) => {
          finishOldPage = resolve
        },
      )
    })
    render(<Harness optionProvider={provider({ searchPage })} />)

    await user.click(
      screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.recipients.addContact' }),
    )
    await screen.findByRole('button', { name: 'Amanda Lin · amanda@example.com' })
    await user.click(
      screen.getByRole('tab', {
        name: 'workflow.nodes.humanInputV2.recipients.contactSource.workspace',
      }),
    )
    await waitFor(() => expect(searchPage).toHaveBeenLastCalledWith('', 2))
    await user.type(
      screen.getByRole('textbox', { name: 'workflow.nodes.humanInputV2.recipients.search' }),
      'Z',
    )
    expect(
      await screen.findByRole('button', { name: 'Zoe Workspace · evan@example.com' }),
    ).toBeInTheDocument()

    await act(async () => {
      finishOldPage({ data: [contact], page: 2, hasMore: false })
    })
    expect(
      screen.getByRole('button', { name: 'Zoe Workspace · evan@example.com' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Evan Zhang · evan@example.com' }),
    ).not.toBeInTheDocument()
    expect(searchPage).toHaveBeenLastCalledWith('Z', 1)
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
    await user.click(
      screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.recipients.insertVariable' }),
    )
    await user.click(screen.getByRole('button', { name: 'insert-dynamic-recipient' }))
    await user.click(
      screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.recipients.addContact' }),
    )
    await user.click(
      screen.getByRole('button', {
        name: 'workflow.nodes.humanInputV2.recipients.type.initiator',
      }),
    )

    expect(observe).toHaveBeenLastCalledWith([
      { type: 'onetime_email', email: 'owner@example.com' },
      { type: 'contact', contact_id: 'contact-evan' },
      { type: 'dynamic_email', selector: ['start', 'owner_email'] },
      { type: 'initiator' },
    ])
  })

  it('edits and removes a recipient through its chip without changing other recipients', async () => {
    const user = userEvent.setup()
    const observe = vi.fn()
    render(
      <Harness
        initial={[{ type: 'onetime_email', email: 'owner@example.com' }, { type: 'initiator' }]}
        observe={observe}
      />,
    )

    expect(screen.queryByRole('button', { name: /recipients\.remove:/ })).not.toBeInTheDocument()
    const chip = screen.getByRole('button', { name: /recipients\.edit:.*owner@example.com/ })
    expect(chip).toHaveTextContent('owner@example.com')
    await user.click(chip)
    const editor = screen.getByRole('group', {
      name: 'workflow.nodes.humanInputV2.recipients.editRecipient',
    })
    await user.click(within(editor).getByRole('button', { name: /recipients\.remove:/ }))

    expect(observe).toHaveBeenLastCalledWith([{ type: 'initiator' }])
    expect(
      screen.queryByRole('group', {
        name: 'workflow.nodes.humanInputV2.recipients.editRecipient',
      }),
    ).not.toBeInTheDocument()
  })

  describe('Backspace in the main recipient input', () => {
    it.each([
      { type: 'contact', contact_id: contact.id },
      { type: 'onetime_email', email: 'last@example.com' },
      { type: 'dynamic_email', selector: ['start', 'email'] },
      { type: 'initiator' },
      { type: 'all_workspace_contacts' },
    ] satisfies HumanInputV2Recipient[])(
      'removes only the preceding $type recipient and keeps input focus',
      async (lastRecipient) => {
        const user = userEvent.setup()
        const observe = vi.fn()
        const firstRecipient: HumanInputV2Recipient = {
          type: 'onetime_email',
          email: 'first@example.com',
        }
        render(<Harness initial={[firstRecipient, lastRecipient]} observe={observe} />)
        const input = screen.getByLabelText('workflow.nodes.humanInputV2.recipients.placeholder')

        await user.click(input)
        await user.keyboard('{Backspace}')

        expect(observe).toHaveBeenCalledExactlyOnceWith([firstRecipient])
        expect(input).toHaveFocus()
        expect(input).toHaveValue('')
      },
    )

    it.each(['text', ' ', 'selected text'])(
      'preserves recipients while Backspace deletes the input draft: %j',
      async (draft) => {
        const user = userEvent.setup()
        const observe = vi.fn()
        render(<Harness initial={[{ type: 'initiator' }]} observe={observe} />)
        const input = screen.getByRole('textbox', {
          name: 'workflow.nodes.humanInputV2.recipients.placeholder',
        })
        await user.type(input, draft)
        if (draft === 'selected text') {
          act(() => {
            if (input instanceof HTMLInputElement) input.setSelectionRange(0, draft.length)
          })
        }

        await user.keyboard('{Backspace}')

        expect(input).toHaveValue(draft === 'selected text' ? '' : draft.slice(0, -1))
        expect(observe).not.toHaveBeenCalled()
      },
    )

    it.each(['ctrlKey', 'metaKey', 'altKey', 'shiftKey'])(
      'leaves modified Backspace to the input when %s is held',
      (modifier) => {
        const observe = vi.fn()
        render(<Harness initial={[{ type: 'initiator' }]} observe={observe} />)
        const input = screen.getByLabelText('workflow.nodes.humanInputV2.recipients.placeholder')

        expect(fireEvent.keyDown(input, { key: 'Backspace', [modifier]: true })).toBe(true)
        expect(observe).not.toHaveBeenCalled()
      },
    )

    it('does not delete recipients while an IME composition handles Backspace', () => {
      const observe = vi.fn()
      render(<Harness initial={[{ type: 'initiator' }]} observe={observe} />)
      const input = screen.getByLabelText('workflow.nodes.humanInputV2.recipients.placeholder')

      expect(fireEvent.keyDown(input, { key: 'Backspace', isComposing: true })).toBe(true)
      expect(observe).not.toHaveBeenCalled()
    })

    it('consumes held-key repeats without deleting more recipients', async () => {
      const user = userEvent.setup()
      const observe = vi.fn()
      render(
        <Harness
          initial={[{ type: 'initiator' }, { type: 'onetime_email', email: 'last@example.com' }]}
          observe={observe}
        />,
      )
      const input = screen.getByLabelText('workflow.nodes.humanInputV2.recipients.placeholder')
      await user.click(input)
      await user.keyboard('{Backspace}')
      expect(observe).toHaveBeenCalledExactlyOnceWith([{ type: 'initiator' }])

      expect(fireEvent.keyDown(input, { key: 'Backspace', repeat: true })).toBe(false)
      expect(observe).toHaveBeenCalledTimes(1)
      expect(input).toHaveFocus()
      await user.keyboard('{Backspace}')
      expect(observe).toHaveBeenLastCalledWith([])
    })

    it('keeps an empty recipient list unchanged', async () => {
      const user = userEvent.setup()
      const observe = vi.fn()
      render(<Harness observe={observe} />)
      const input = screen.getByLabelText('workflow.nodes.humanInputV2.recipients.placeholder')

      await user.click(input)
      await user.keyboard('{Backspace}')

      expect(observe).not.toHaveBeenCalled()
      expect(input).toHaveFocus()
    })

    it('closes the editor when Backspace removes its recipient', async () => {
      const user = userEvent.setup()
      const observe = vi.fn()
      render(
        <Harness
          initial={[{ type: 'initiator' }, { type: 'onetime_email', email: 'last@example.com' }]}
          observe={observe}
        />,
      )
      await user.click(screen.getByRole('button', { name: /recipients\.edit:.*last@example.com/ }))
      expect(
        screen.getByRole('group', { name: 'workflow.nodes.humanInputV2.recipients.editRecipient' }),
      ).toBeInTheDocument()
      const input = screen.getByLabelText('workflow.nodes.humanInputV2.recipients.placeholder')
      await user.click(input)
      await user.keyboard('{Backspace}')

      expect(observe).toHaveBeenCalledExactlyOnceWith([{ type: 'initiator' }])
      expect(
        screen.queryByRole('group', {
          name: 'workflow.nodes.humanInputV2.recipients.editRecipient',
        }),
      ).not.toBeInTheDocument()
      expect(input).toHaveFocus()
    })

    it('preserves another recipient editor draft when Backspace removes the last recipient', async () => {
      const user = userEvent.setup()
      const observe = vi.fn()
      const firstRecipient: HumanInputV2Recipient = {
        type: 'onetime_email',
        email: 'first@example.com',
      }
      render(<Harness initial={[firstRecipient, { type: 'initiator' }]} observe={observe} />)
      await user.click(screen.getByRole('button', { name: /recipients\.edit:.*first@example.com/ }))
      const editor = screen.getByRole('group', {
        name: 'workflow.nodes.humanInputV2.recipients.editRecipient',
      })
      const editorInput = within(editor).getByRole('textbox', {
        name: 'workflow.nodes.humanInputV2.recipients.emailLabel',
      })
      await user.clear(editorInput)
      await user.type(editorInput, 'edited@example.com')
      await user.click(screen.getByLabelText('workflow.nodes.humanInputV2.recipients.placeholder'))
      await user.keyboard('{Backspace}')

      expect(observe).toHaveBeenCalledExactlyOnceWith([firstRecipient])
      expect(editorInput).toHaveValue('edited@example.com')
      await user.click(
        within(editor).getByRole('button', {
          name: 'workflow.nodes.humanInputV2.recipients.confirm',
        }),
      )
      expect(observe).toHaveBeenLastCalledWith([
        { type: 'onetime_email', email: 'edited@example.com' },
      ])
    })

    it('keeps focus in the main input after closing its search and deleting a recipient', async () => {
      const user = userEvent.setup()
      const observe = vi.fn()
      render(<Harness initial={[{ type: 'initiator' }]} observe={observe} />)
      const input = screen.getByLabelText('workflow.nodes.humanInputV2.recipients.placeholder')
      await user.type(input, 'Evan')
      await screen.findByRole('button', { name: 'Evan Zhang · evan@example.com' })
      await user.clear(input)
      await waitFor(() =>
        expect(
          screen.queryByRole('button', { name: 'Evan Zhang · evan@example.com' }),
        ).not.toBeInTheDocument(),
      )
      expect(input).toHaveFocus()

      await user.keyboard('{Backspace}')

      expect(observe).toHaveBeenCalledExactlyOnceWith([])
      expect(input).toHaveFocus()
    })

    it('does not remove recipients from the separate picker search or email editor', async () => {
      const user = userEvent.setup()
      const observe = vi.fn()
      render(
        <Harness
          initial={[{ type: 'initiator' }, { type: 'onetime_email', email: 'last@example.com' }]}
          observe={observe}
        />,
      )
      await user.click(
        screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.recipients.addContact' }),
      )
      const search = screen.getByRole('textbox', {
        name: 'workflow.nodes.humanInputV2.recipients.search',
      })
      await user.click(search)
      await user.keyboard('{Backspace}{Escape}')
      await user.click(screen.getByRole('button', { name: /recipients\.edit:.*last@example.com/ }))
      const editorInput = screen.getByRole('textbox', {
        name: 'workflow.nodes.humanInputV2.recipients.emailLabel',
      })
      await user.clear(editorInput)
      await user.keyboard('{Backspace}')

      expect(observe).not.toHaveBeenCalled()
      expect(editorInput).toHaveValue('')
    })

    it('does not expose a main input or remove recipients in readonly mode', async () => {
      const user = userEvent.setup()
      const observe = vi.fn()
      render(
        <Harness
          initial={[{ type: 'contact', contact_id: contact.id }]}
          readonly
          observe={observe}
        />,
      )
      const chip = await screen.findByRole('button', { name: 'Evan Zhang · evan@example.com' })
      expect(
        screen.queryByLabelText('workflow.nodes.humanInputV2.recipients.placeholder'),
      ).not.toBeInTheDocument()
      act(() => chip.focus())
      await user.keyboard('{Backspace}')

      expect(observe).not.toHaveBeenCalled()
      expect(chip).toBeInTheDocument()
    })
  })

  it('opens the selected contact editor instead of leaving its hover card over the controls', async () => {
    const user = userEvent.setup()
    const observe = vi.fn()
    render(<Harness initial={[{ type: 'contact', contact_id: contact.id }]} observe={observe} />)
    const chip = await screen.findByRole('button', { name: 'Evan Zhang · evan@example.com' })

    await user.hover(chip)
    await screen.findByRole('dialog', { name: contact.name })
    await user.click(chip)
    expect(
      screen.getByRole('group', {
        name: 'workflow.nodes.humanInputV2.recipients.editRecipient',
      }),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: contact.name })).not.toBeInTheDocument(),
    )
    expect(observe).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    'explains an invalid imported email without changing the recipient (readonly=%s)',
    async (readonly) => {
      const user = userEvent.setup()
      const observe = vi.fn()
      render(
        <Harness
          initial={[{ type: 'onetime_email', email: 'invalid-email' }]}
          observe={observe}
          readonly={readonly}
        />,
      )
      const chip = screen.getByRole('button', { name: /invalid-email/ })

      await user.hover(chip)
      expect(
        await screen.findByText('workflow.nodes.humanInputV2.recipients.emailInvalidOrDuplicate'),
      ).toBeVisible()
      if (readonly) {
        await user.click(chip)
        expect(
          screen.queryByRole('group', {
            name: 'workflow.nodes.humanInputV2.recipients.editRecipient',
          }),
        ).not.toBeInTheDocument()
      }
      expect(observe).not.toHaveBeenCalled()
    },
  )

  it('limits initiator and whole-workspace choices to their designed source tabs', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(
      screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.recipients.addContact' }),
    )
    expect(
      screen.getByRole('button', {
        name: 'workflow.nodes.humanInputV2.recipients.type.initiator',
      }),
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole('tab', {
        name: 'workflow.nodes.humanInputV2.recipients.contactSource.workspace',
      }),
    )
    expect(
      screen.queryByRole('button', {
        name: 'workflow.nodes.humanInputV2.recipients.type.initiator',
      }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: 'workflow.nodes.humanInputV2.recipients.allWorkspaceContacts',
      }),
    ).toBeInTheDocument()

    await user.click(
      screen.getByRole('tab', {
        name: 'workflow.nodes.humanInputV2.recipients.contactSource.external',
      }),
    )
    expect(
      screen.queryByRole('button', {
        name: 'workflow.nodes.humanInputV2.recipients.type.initiator',
      }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', {
        name: 'workflow.nodes.humanInputV2.recipients.allWorkspaceContacts',
      }),
    ).not.toBeInTheDocument()
  })

  it('locks a different contact with a selected email and replaces only that contact from its preview', async () => {
    const user = userEvent.setup()
    const observe = vi.fn()
    const sameEmailContact: ContactRecipientOption = {
      id: 'contact-beverly',
      name: 'Beverly',
      email: organizationContact.email.toUpperCase(),
      source: 'workspace',
    }
    render(
      <Harness
        initial={[
          { type: 'onetime_email', email: 'owner@example.com' },
          { type: 'contact', contact_id: organizationContact.id },
          { type: 'initiator' },
        ]}
        optionProvider={provider({
          resolve: vi.fn(async () => [organizationContact]),
          search: vi.fn(async () => [organizationContact, sameEmailContact]),
        })}
        observe={observe}
      />,
    )

    await screen.findByRole('button', { name: 'Amanda Lin · amanda@example.com' })
    await user.click(
      screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.recipients.addContact' }),
    )
    const candidate = await screen.findByRole('button', {
      name: 'Beverly · AMANDA@EXAMPLE.COM',
    })
    expect(candidate).toHaveAttribute('aria-disabled', 'true')
    await user.hover(candidate)
    const preview = await screen.findByRole('dialog', { name: 'Beverly' })
    expect(within(preview).getByText(/recipients\.duplicateSource.*Amanda Lin/)).toBeInTheDocument()
    expect(
      within(preview).getByText('workflow.nodes.humanInputV2.recipients.emailAlreadySelected'),
    ).toBeInTheDocument()
    expect(observe).not.toHaveBeenCalled()
    await user.click(
      within(preview).getByRole('button', {
        name: 'workflow.nodes.humanInputV2.recipients.useThisInstead',
      }),
    )

    expect(observe).toHaveBeenLastCalledWith([
      { type: 'onetime_email', email: 'owner@example.com' },
      { type: 'contact', contact_id: sameEmailContact.id },
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
        name: 'contacts.type.platform',
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
      screen.getByRole('button', { name: /recipients\.edit:.*recipients\.type\.initiator/ }),
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
      screen.getByRole('button', { name: /recipients\.edit:.*allWorkspaceContacts/ }),
    )
    await user.click(
      screen.getByRole('button', { name: /recipients\.remove:.*allWorkspaceContacts/ }),
    )
    expect(observe).toHaveBeenLastCalledWith([{ type: 'initiator' }])
  })
})
