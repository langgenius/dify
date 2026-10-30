import type { OrganizationCandidate } from '@dify/contracts/api/console/workspaces/types.gen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { createDeferred } from '@/test/deferred'
import { ContactsManagementProvider } from '../composition'
import { PlatformContactPickerDialog } from '../platform-contact-picker-dialog'
import { alice, managerContext } from './fixtures/data'

const api = vi.hoisted(() => ({ candidates: vi.fn(), existing: vi.fn(), add: vi.fn() }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.humanInput.v2.organizationCandidates.get': api.candidates,
      'workspaces.current.humanInput.v2.contacts.batch.get': api.existing,
      'workspaces.current.humanInput.v2.contacts.platform.post': api.add,
    }),
  }
})
const candidate: OrganizationCandidate = { id: alice.id, name: alice.name, email: alice.email! }
function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  function Host() {
    const [open, setOpen] = useState(false)
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open picker
        </button>
        <PlatformContactPickerDialog open={open} onOpenChange={setOpen} />
      </>
    )
  }
  const content = (workspaceId: string) => (
    <QueryClientProvider client={queryClient}>
      <ContactsManagementProvider
        context={{ ...managerContext, workspaceId, imCentrallyManaged: true }}
      >
        <Host />
      </ContactsManagementProvider>
    </QueryClientProvider>
  )
  const view = render(content(managerContext.workspaceId))
  return (workspaceId: string) => view.rerender(content(workspaceId))
}
async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Open picker' }))
  return screen.findByRole('dialog')
}
beforeEach(() => {
  api.candidates.mockReset().mockResolvedValue({ data: [candidate], page: 1, limit: 100, total: 1 })
  api.existing.mockReset().mockResolvedValue({ data: [] })
  api.add.mockReset().mockResolvedValue({ data: [{ ...alice, type: 'platform' }] })
})

it('opens with a visible close control and an always-available Cancel action', async () => {
  const user = userEvent.setup()
  setup()
  await open(user)
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'contacts.action.close' })).toHaveFocus(),
  )
  expect(screen.getByRole('button', { name: 'contacts.action.cancel' })).toBeVisible()
})

it('automatically skips imported pages and stops when a selectable contact is found', async () => {
  const user = userEvent.setup()
  const next: OrganizationCandidate = { ...candidate, id: 'next-candidate', name: 'Next available' }
  api.candidates.mockImplementation(async ({ query }: { query: { page: number } }) => ({
    data: query.page < 3 ? [{ ...candidate, id: `imported-${query.page}` }] : [next],
    page: query.page,
    limit: 100,
    total: 301,
  }))
  api.existing.mockImplementation(async ({ query }: { query: { contact_ids: string[] } }) => ({
    data: query.contact_ids[0]?.startsWith('imported-')
      ? [{ id: query.contact_ids[0], name: candidate.name, created_at: alice.created_at }]
      : [],
  }))
  setup()
  await open(user)
  expect(await screen.findByText('Next available')).toBeInTheDocument()
  expect(api.candidates.mock.calls.map(([input]) => input.query.page)).toEqual([1, 2, 3])
  expect(api.existing).toHaveBeenCalledTimes(3)
  expect(screen.getByRole('button', { name: 'contacts.action.loadMore' })).toBeVisible()
})

it('finishes with an empty state after every remaining candidate was already imported', async () => {
  const user = userEvent.setup()
  api.candidates.mockImplementation(async ({ query }: { query: { page: number } }) => ({
    data: [{ ...candidate, id: `imported-${query.page}` }],
    page: query.page,
    limit: 100,
    total: 101,
  }))
  api.existing.mockImplementation(async ({ query }: { query: { contact_ids: string[] } }) => ({
    data: query.contact_ids.map((id) => ({
      id,
      name: candidate.name,
      created_at: alice.created_at,
    })),
  }))
  setup()
  await open(user)
  expect(await screen.findByText('contacts.platformPicker.empty')).toBeInTheDocument()
  expect(api.candidates.mock.calls.map(([input]) => input.query.page)).toEqual([1, 2])
  expect(screen.queryByRole('button', { name: 'contacts.action.loadMore' })).not.toBeInTheDocument()
})

it('retries a failed continuation without discarding the already cached imported page', async () => {
  const user = userEvent.setup()
  let fail = true
  api.candidates.mockImplementation(async ({ query }: { query: { page: number } }) => {
    if (query.page === 2 && fail) {
      fail = false
      throw new Error('Temporary candidate failure')
    }
    return {
      data: query.page === 1 ? [candidate] : [{ ...candidate, id: 'next', name: 'Recovered' }],
      page: query.page,
      limit: 100,
      total: 101,
    }
  })
  api.existing.mockImplementation(async ({ query }: { query: { contact_ids: string[] } }) => ({
    data: query.contact_ids.includes(candidate.id)
      ? [{ id: candidate.id, name: candidate.name, created_at: alice.created_at }]
      : [],
  }))
  setup()
  await open(user)
  expect(await screen.findByRole('alert')).toHaveTextContent('contacts.platformPicker.error')
  await user.click(screen.getByRole('button', { name: 'contacts.action.retry' }))
  expect(await screen.findByText('Recovered')).toBeVisible()
  expect(api.candidates.mock.calls.map(([input]) => input.query.page)).toEqual([1, 2, 2])
})

it('does not treat a failed existing-contact lookup as an empty imported page', async () => {
  const user = userEvent.setup()
  api.candidates.mockResolvedValue({ data: [candidate], page: 1, limit: 100, total: 101 })
  api.existing.mockRejectedValueOnce(new Error('Lookup unavailable'))
  setup()
  await open(user)
  expect(await screen.findByRole('alert')).toHaveTextContent('contacts.platformPicker.error')
  expect(api.candidates).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'contacts.action.retry' }))
  expect(await screen.findByRole('checkbox', { name: /selectContact.*Alice/ })).toBeVisible()
})

it('stops instead of looping when a continuation repeats a previous server page', async () => {
  const user = userEvent.setup()
  api.candidates.mockResolvedValue({ data: [candidate], page: 1, limit: 100, total: 101 })
  api.existing.mockResolvedValue({
    data: [{ id: candidate.id, name: candidate.name, created_at: alice.created_at }],
  })
  setup()
  await open(user)
  expect(await screen.findByRole('alert')).toHaveTextContent('contacts.platformPicker.error')
  expect(api.candidates.mock.calls.map(([input]) => input.query.page)).toEqual([1, 2])
})

it('does not advance an abandoned search when its delayed candidate page arrives', async () => {
  const user = userEvent.setup()
  const oldPage = createDeferred<{
    data: OrganizationCandidate[]
    page: number
    limit: number
    total: number
  }>()
  api.candidates.mockImplementation(({ query }: { query: { keyword?: string } }) =>
    query.keyword
      ? Promise.resolve({
          data: [{ ...candidate, id: 'new', name: 'Current search' }],
          page: 1,
          limit: 100,
          total: 1,
        })
      : oldPage.promise,
  )
  setup()
  await open(user)
  await waitFor(() => expect(api.candidates).toHaveBeenCalledTimes(1))
  await user.type(screen.getByRole('searchbox', { name: 'contacts.platformPicker.search' }), 'new')
  expect(await screen.findByText('Current search')).toBeVisible()
  await act(async () => oldPage.resolve({ data: [candidate], page: 1, limit: 100, total: 101 }))
  expect(
    api.existing.mock.calls.some(([input]) => input.query.contact_ids.includes(candidate.id)),
  ).toBe(false)
  expect(api.candidates.mock.calls.some(([input]) => input.query.page > 1)).toBe(false)
  expect(screen.getByText('Current search')).toBeVisible()
})

it('isolates a new workspace from an old in-flight candidate page', async () => {
  const user = userEvent.setup()
  const oldPage = createDeferred<{
    data: OrganizationCandidate[]
    page: number
    limit: number
    total: number
  }>()
  api.candidates.mockReturnValueOnce(oldPage.promise).mockResolvedValue({
    data: [{ ...candidate, id: 'new-workspace', name: 'Current workspace' }],
    page: 1,
    limit: 100,
    total: 1,
  })
  const switchWorkspace = setup()
  await open(user)
  await waitFor(() => expect(api.candidates).toHaveBeenCalledTimes(1))
  switchWorkspace('workspace-2')
  expect(await screen.findByText('Current workspace')).toBeVisible()
  await act(async () => oldPage.resolve({ data: [candidate], page: 1, limit: 100, total: 101 }))
  expect(
    api.existing.mock.calls.some(([input]) => input.query.contact_ids.includes(candidate.id)),
  ).toBe(false)
  expect(api.candidates.mock.calls.some(([input]) => input.query.page > 1)).toBe(false)
  expect(screen.getByText('Current workspace')).toBeVisible()
})

it('adds selected IDs through the real generated mutation shape', async () => {
  const user = userEvent.setup()
  setup()
  await open(user)
  await user.click(await screen.findByRole('checkbox', { name: /selectContact.*Alice/ }))
  await user.click(screen.getByRole('button', { name: 'contacts.platformPicker.add' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(api.add).toHaveBeenCalledWith({ body: { candidate_ids: [alice.id] } })
})

it('retains the selection on conflict and clears it only after closing the content session', async () => {
  const user = userEvent.setup()
  api.add.mockRejectedValueOnce(Object.assign(new Error('Conflict'), { status: 409 }))
  setup()
  await open(user)
  await user.click(await screen.findByRole('checkbox', { name: /selectContact.*Alice/ }))
  await user.click(screen.getByRole('button', { name: 'contacts.platformPicker.add' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('contacts.platformPicker.addConflict')
  expect(screen.getByRole('checkbox', { name: /selectContact.*Alice/ })).toBeChecked()
  await user.click(screen.getByRole('button', { name: 'contacts.action.cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await open(user)
  expect(await screen.findByRole('checkbox', { name: /selectContact.*Alice/ })).not.toBeChecked()
})

it('blocks closing during a pending import and does not add duplicates', async () => {
  const user = userEvent.setup()
  const request = createDeferred<{ data: [] }>()
  api.add.mockReturnValueOnce(request.promise)
  setup()
  await open(user)
  await user.click(await screen.findByRole('checkbox', { name: /selectContact.*Alice/ }))
  const add = screen.getByRole('button', { name: 'contacts.platformPicker.add' })
  await user.click(add)
  await user.click(add)
  await user.keyboard('{Escape}')
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(api.add).toHaveBeenCalledOnce()
  await act(async () => request.resolve({ data: [] }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})
