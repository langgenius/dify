import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { ContactsManagementProvider } from '../composition'
import { ContactsDirectoryPage } from '../directory-page'
import { alice, managerContext } from './fixtures/data'

const network = vi.hoisted(() => ({
  details: vi.fn<() => Response>(),
}))

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

vi.mock('@/service/base', async () => {
  const { httpErrorFromResponse } = await import('@/service/http-error')
  return {
    request: async (_url: string, _init: RequestInit, options: { request: Request }) => {
      const url = new URL(options.request.url)
      const response = url.pathname.endsWith(`/contacts/${alice.id}`)
        ? network.details()
        : url.pathname.endsWith('/channels')
          ? json({ channels: [] })
          : json({
              data: url.searchParams.get('group') === 'workspace' ? [] : [alice],
              page: 1,
              limit: Number(url.searchParams.get('limit')) || 20,
              total: url.searchParams.get('group') === 'workspace' ? 0 : 1,
            })
      if (!response.ok) throw await httpErrorFromResponse(response)
      return response
    },
  }
})
vi.mock('@/utils/client', () => ({ isClient: true, isServer: false }))

let client: QueryClient
beforeEach(() => {
  network.details.mockReset()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})
afterEach(() => client.clear())

const openDetails = async () => {
  const user = userEvent.setup()
  render(
    <QueryClientTestProvider queryClient={client}>
      <NuqsTestingAdapter hasMemory>
        <ContactsManagementProvider context={managerContext}>
          <ContactsDirectoryPage />
        </ContactsManagementProvider>
      </NuqsTestingAdapter>
    </QueryClientTestProvider>,
  )
  await user.click(await screen.findByRole('button', { name: /Alice alice@example.com/ }))
  return { user, panel: screen.getByRole('region', { name: 'contacts.details.title' }) }
}

it('shows a removed contact as no longer in the directory after HTTP 404 without retry', async () => {
  network.details.mockReturnValue(json({ code: 'not_found', message: 'Contact removed' }, 404))
  const { panel } = await openDetails()
  expect(await within(panel).findByText('contacts.details.notFound')).toBeVisible()
  expect(within(panel).queryByText('contacts.details.error')).not.toBeInTheDocument()
  expect(
    within(panel).queryByRole('button', { name: 'contacts.action.retry' }),
  ).not.toBeInTheDocument()
  expect(network.details).toHaveBeenCalledOnce()
})

it('offers retry after HTTP 500 and opens the recovered contact details', async () => {
  network.details
    .mockReturnValueOnce(json({ code: 'internal_server_error', message: 'Unavailable' }, 500))
    .mockImplementation(() => json({ contact: alice, im_binding_details: [] }))
  const { user, panel } = await openDetails()
  expect(await within(panel).findByRole('alert')).toHaveTextContent('contacts.details.error')
  await user.click(within(panel).getByRole('button', { name: 'contacts.action.retry' }))
  expect(await screen.findByRole('region', { name: 'Alice' })).toBeVisible()
  await waitFor(() => expect(network.details).toHaveBeenCalledTimes(2))
})
