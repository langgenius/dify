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
  render(
    <QueryClientProvider client={queryClient}>
      <ContactsManagementProvider context={{ ...managerContext, imCentrallyManaged: true }}>
        <Host />
      </ContactsManagementProvider>
    </QueryClientProvider>,
  )
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

it('uses generated pagination and gives an explicit empty state when a whole page was already imported', async () => {
  const user = userEvent.setup()
  const next: OrganizationCandidate = { ...candidate, id: 'next-candidate', name: 'Next available' }
  api.candidates.mockImplementation(async ({ query }: { query: { page: number } }) => ({
    data: query.page === 1 ? [candidate] : [next],
    page: query.page,
    limit: 100,
    total: 101,
  }))
  api.existing.mockImplementation(async ({ query }: { query: { contact_ids: string[] } }) => ({
    data: query.contact_ids.includes(candidate.id)
      ? [{ id: candidate.id, name: candidate.name, created_at: alice.created_at }]
      : [],
  }))
  setup()
  await open(user)
  expect(await screen.findByText('contacts.platformPicker.empty')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'contacts.action.loadMore' }))
  expect(await screen.findByText('Next available')).toBeInTheDocument()
  expect(api.candidates.mock.calls.map(([input]) => input.query.page)).toEqual([1, 2])
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
