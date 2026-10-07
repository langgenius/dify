import type { ApiBasedExtensionResponse } from '@dify/contracts/api/console/api-based-extension/types.gen'
import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { seedSystemFeatures } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { seedWorkspacePermissionsQuery } from '@/test/console/workspace-permissions'
import { ApiBasedExtensionPage } from '../index'

const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/service/base', () => ({
  request,
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
  getPublic: vi.fn(),
  getMarketplace: vi.fn(),
  postPublic: vi.fn(),
  postMarketplace: vi.fn(),
  delPublic: vi.fn(),
  patchPublic: vi.fn(),
  upload: vi.fn(),
  ssePost: vi.fn(),
  sseGet: vi.fn(),
  sseGeneratorPost: vi.fn(),
  handleStream: vi.fn(),
  buildSigninUrlWithRedirect: vi.fn(),
  isWebAppSigninPath: vi.fn(),
  buildWebAppSigninUrlWithRedirect: vi.fn(),
}))

const existing: ApiBasedExtensionResponse = {
  id: 'existing',
  name: 'Existing',
  api_endpoint: 'https://existing.test',
  api_key: 'existing-secret',
}
const clients: QueryClient[] = []
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  })
  clients.push(client)
  seedAccountProfileQuery(client)
  seedSystemFeatures(client, { deployment_edition: 'COMMUNITY' })
  seedWorkspacePermissionsQuery(client, ['api_extension.manage'])
  client.setQueryData(consoleQuery.apiBasedExtension.get.queryKey(), [existing])
  render(
    <QueryClientTestProvider queryClient={client}>
      <ApiBasedExtensionPage />
    </QueryClientTestProvider>,
  )
  return client
}
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear())
})
it('keeps an edited draft after failure and retries with the unchanged-key sentinel before updating the list cache', async () => {
  const user = userEvent.setup()
  const requests: { path: string; body: unknown }[] = []
  request.mockImplementation(
    async (_url: string, _init: RequestInit, options: { request: Request }) => {
      const req = options.request
      expect(req.method).toBe('POST')
      const body = await req.json()
      requests.push({ path: new URL(req.url).pathname, body })
      if (requests.length === 1) return Response.json({ message: 'Retry later' }, { status: 500 })
      return Response.json({ ...existing, ...body, api_key: existing.api_key })
    },
  )
  const client = setup()
  await user.click(screen.getByRole('button', { name: 'common.operation.edit Existing' }))
  const dialog = within(
    screen.getByRole('dialog', { name: 'common.apiBasedExtension.modal.editTitle' }),
  )
  const name = dialog.getByRole('textbox', { name: 'common.apiBasedExtension.modal.name.title' })
  await user.clear(name)
  await user.type(name, 'Edited')
  await user.click(dialog.getByRole('button', { name: 'common.operation.save' }))
  await waitFor(() => expect(requests).toHaveLength(1))
  await waitFor(() =>
    expect(dialog.getByRole('button', { name: 'common.operation.save' })).toBeEnabled(),
  )
  expect(name).toHaveValue('Edited')
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  await user.click(dialog.getByRole('button', { name: 'common.operation.save' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(requests).toEqual(
    [0, 1].map(() => ({
      path: '/console/api/api-based-extension/existing',
      body: { name: 'Edited', api_endpoint: 'https://existing.test', api_key: '[__HIDDEN__]' },
    })),
  )
  expect(client.getQueryData(consoleQuery.apiBasedExtension.get.queryKey())).toEqual([
    { ...existing, name: 'Edited' },
  ])
  expect(request).toHaveBeenCalledTimes(2)
})
