import type { GetAccountProfileResponse } from '@dify/contracts/api/console/account/types.gen'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import AccountPage from '../index'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  request: vi.fn(),
}))

vi.mock('@/service/base', () => ({
  del: vi.fn(),
  get: mocks.get,
  patch: vi.fn(),
  post: vi.fn(),
  request: mocks.request,
  sseGeneratorPost: vi.fn(),
}))

const createAccountResponse = (name = 'Alice'): GetAccountProfileResponse => ({
  id: 'user-id',
  name,
  email: 'alice@example.com',
  avatar: '',
  avatar_url: null,
  is_password_set: false,
  interface_language: 'en-US',
  timezone: 'UTC',
})

const renderPage = () => {
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(
    consoleQuery.apps.get.queryOptions({
      input: { query: { page: 1, limit: 100, name: '' } },
    }).queryKey,
    { data: [], has_more: false, limit: 100, page: 1, total: 0 },
  )

  return renderWithConsoleQuery(<AccountPage />, {
    queryClient,
    accountProfile: createAccountResponse(),
    features: { education: { enabled: false } },
  })
}

describe('AccountPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.get.mockImplementation(
      async () =>
        new Response(JSON.stringify(createAccountResponse('Alice Cooper')), {
          headers: { 'content-type': 'application/json' },
        }),
    )
    mocks.request.mockImplementation(
      async () =>
        new Response(JSON.stringify(createAccountResponse('Alice Cooper')), {
          headers: { 'content-type': 'application/json' },
        }),
    )
  })

  it('updates the account name through the profile endpoint', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
    const nameInput = await screen.findByRole('textbox', { name: 'accountSettings.account.name' })
    await user.clear(nameInput)
    await user.type(nameInput, 'Alice Cooper')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    await waitFor(() => {
      expect(mocks.request).toHaveBeenCalled()
    })
    expect(mocks.request.mock.calls[0]?.[0]).toEqual(expect.stringContaining('/account/profile'))
    const request = mocks.request.mock.calls[0]?.[2]?.request as Request
    expect(request.method).toBe('PATCH')
    await expect(request.json()).resolves.toEqual({ name: 'Alice Cooper' })
  })
})
