import type { GetAccountProfileResponse } from '@dify/contracts/api/console/account/types.gen'
import { act, screen, waitFor, within } from '@testing-library/react'
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

const renderPage = ({ isPasswordSet = false, passwordLoginEnabled = true } = {}) => {
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(
    consoleQuery.apps.get.queryOptions({
      input: { query: { page: 1, limit: 100, name: '' } },
    }).queryKey,
    { data: [], has_more: false, limit: 100, page: 1, total: 0 },
  )

  return renderWithConsoleQuery(<AccountPage />, {
    queryClient,
    accountProfile: { ...createAccountResponse(), is_password_set: isPasswordSet },
    systemFeatures: { enable_email_password_login: passwordLoginEnabled },
    features: { education: { enabled: false } },
  })
}

function pendingResponse() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((resolveResponse) => {
    resolve = resolveResponse
  })
  return { promise, resolve }
}

describe('AccountPage', () => {
  beforeEach(() => {
    vi.resetAllMocks()
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
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getAllByText('Alice Cooper')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
    expect(screen.getByRole('textbox', { name: 'accountSettings.account.name' })).toHaveValue(
      'Alice Cooper',
    )
  })

  it.each(['cancel', 'escape', 'backdrop'])(
    'discards a name draft after closing with %s',
    async (dismissal) => {
      const user = userEvent.setup()
      renderPage()

      await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
      const nameInput = screen.getByRole('textbox', { name: 'accountSettings.account.name' })
      await user.clear(nameInput)
      await user.type(nameInput, 'Unsaved name')
      if (dismissal === 'cancel')
        await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
      else if (dismissal === 'escape') await user.keyboard('{Escape}')
      else await user.click(document.body)
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))

      expect(screen.getByRole('textbox', { name: 'accountSettings.account.name' })).toHaveValue(
        'Alice',
      )
      expect(mocks.request).not.toHaveBeenCalled()
    },
  )

  it('keeps the name draft after failure and allows retry through Enter', async () => {
    const user = userEvent.setup()
    mocks.request.mockRejectedValueOnce(new Error('Name update failed'))
    renderPage()

    await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
    const nameInput = screen.getByRole('textbox', { name: 'accountSettings.account.name' })
    await user.clear(nameInput)
    await user.type(nameInput, 'Alice Cooper{Enter}')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'common.operation.save' })).not.toHaveAttribute(
        'aria-disabled',
        'true',
      ),
    )
    expect(
      screen.getByRole('dialog', { name: 'accountSettings.account.editName' }),
    ).toBeInTheDocument()
    expect(nameInput).toHaveValue('Alice Cooper')
    expect(mocks.request).toHaveBeenCalledOnce()

    await user.click(nameInput)
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.request).toHaveBeenCalledTimes(2)
  })

  it('keeps name editing open until both saving and profile refresh finish', async () => {
    const user = userEvent.setup()
    const saving = pendingResponse()
    const refreshing = pendingResponse()
    mocks.request.mockReturnValueOnce(saving.promise)
    mocks.get.mockReturnValueOnce(refreshing.promise)
    renderPage()

    await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
    await user.type(
      screen.getByRole('textbox', { name: 'accountSettings.account.name' }),
      ' Cooper',
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    const dialog = screen.getByRole('dialog', { name: 'accountSettings.account.editName' })
    const cancel = within(dialog).getByRole('button', { name: 'common.operation.cancel' })
    expect(cancel).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'common.operation.save' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await user.click(cancel)
    await user.keyboard('{Escape}')
    await user.click(document.body)
    expect(dialog).toBeInTheDocument()
    expect(mocks.request).toHaveBeenCalledOnce()

    await act(async () =>
      saving.resolve(new Response(JSON.stringify(createAccountResponse('Alice Cooper')))),
    )
    await waitFor(() => expect(mocks.get).toHaveBeenCalled())
    expect(cancel).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'common.operation.save' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await user.keyboard('{Escape}')
    expect(dialog).toBeInTheDocument()

    await act(async () =>
      refreshing.resolve(new Response(JSON.stringify(createAccountResponse('Alice Cooper')))),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getAllByText('Alice Cooper')).toHaveLength(2)
  })

  it.each([false, true])(
    'starts a fresh password session when isPasswordSet=%s',
    async (isPasswordSet) => {
      const user = userEvent.setup()
      renderPage({ isPasswordSet })
      const triggerName = isPasswordSet
        ? 'accountSettings.account.resetPassword'
        : 'accountSettings.account.setPassword'
      const passwordName = isPasswordSet
        ? 'accountSettings.account.newPassword'
        : 'accountSettings.account.password'
      await user.click(screen.getByRole('button', { name: triggerName }))

      if (isPasswordSet) {
        const current = screen.getByLabelText('accountSettings.account.currentPassword')
        expect(current).toHaveAttribute('autocomplete', 'current-password')
        await user.type(current, 'Current123')
      } else {
        expect(
          screen.queryByLabelText('accountSettings.account.currentPassword'),
        ).not.toBeInTheDocument()
      }
      const password = screen.getByLabelText(passwordName)
      const confirm = screen.getByLabelText('accountSettings.account.confirmPassword')
      expect(password).toHaveAttribute('autocomplete', 'new-password')
      expect(confirm).toHaveAttribute('autocomplete', 'new-password')
      await user.type(password, 'NewPassword123')
      await user.type(confirm, 'NewPassword123')
      for (const toggle of screen.getAllByRole('button', { name: 'login.showPassword' })) {
        await user.click(toggle)
      }
      expect(password).toHaveAttribute('type', 'text')
      await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      await user.click(screen.getByRole('button', { name: triggerName }))

      expect(screen.getByLabelText(passwordName)).toHaveValue('')
      expect(screen.getByLabelText(passwordName)).toHaveAttribute('type', 'password')
      expect(screen.getByLabelText('accountSettings.account.confirmPassword')).toHaveValue('')
      expect(screen.getByLabelText('accountSettings.account.confirmPassword')).toHaveAttribute(
        'type',
        'password',
      )
      if (isPasswordSet) {
        expect(screen.getByLabelText('accountSettings.account.currentPassword')).toHaveValue('')
        expect(screen.getByLabelText('accountSettings.account.currentPassword')).toHaveAttribute(
          'type',
          'password',
        )
      }
      expect(mocks.request).not.toHaveBeenCalled()
    },
  )

  it('keeps all password values after a failed reset and retries the generated endpoint', async () => {
    const user = userEvent.setup()
    mocks.request.mockRejectedValueOnce(new Error('Password update failed'))
    mocks.get.mockResolvedValue(
      new Response(JSON.stringify({ ...createAccountResponse(), is_password_set: true })),
    )
    renderPage({ isPasswordSet: true })
    await user.click(screen.getByRole('button', { name: 'accountSettings.account.resetPassword' }))
    await user.type(screen.getByLabelText('accountSettings.account.currentPassword'), 'Current123')
    await user.type(screen.getByLabelText('accountSettings.account.newPassword'), 'NewPassword123')
    await user.type(
      screen.getByLabelText('accountSettings.account.confirmPassword'),
      'NewPassword123{Enter}',
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'common.operation.reset' })).not.toHaveAttribute(
        'aria-disabled',
        'true',
      ),
    )

    expect(screen.getByLabelText('accountSettings.account.currentPassword')).toHaveValue(
      'Current123',
    )
    expect(screen.getByLabelText('accountSettings.account.newPassword')).toHaveValue(
      'NewPassword123',
    )
    expect(screen.getByLabelText('accountSettings.account.confirmPassword')).toHaveValue(
      'NewPassword123',
    )
    expect(mocks.request).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'common.operation.reset' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.request).toHaveBeenCalledTimes(2)
    const request = mocks.request.mock.calls[1]?.[2]?.request as Request
    expect(request.method).toBe('POST')
    expect(request.url).toContain('/account/password')
    await expect(request.json()).resolves.toEqual({
      password: 'Current123',
      new_password: 'NewPassword123',
      repeat_new_password: 'NewPassword123',
    })
  })

  it('keeps password setting open until the refreshed profile confirms the new password', async () => {
    const user = userEvent.setup()
    const saving = pendingResponse()
    const refreshing = pendingResponse()
    mocks.request.mockReturnValueOnce(saving.promise)
    mocks.get.mockReturnValueOnce(refreshing.promise)
    renderPage()
    await user.click(screen.getByRole('button', { name: 'accountSettings.account.setPassword' }))
    await user.type(screen.getByLabelText('accountSettings.account.password'), 'NewPassword123')
    await user.type(
      screen.getByLabelText('accountSettings.account.confirmPassword'),
      'NewPassword123{Enter}',
    )
    const dialog = screen.getByRole('dialog', { name: 'accountSettings.account.setPassword' })
    const cancel = within(dialog).getByRole('button', { name: 'common.operation.cancel' })
    expect(cancel).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'common.operation.save' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await user.click(cancel)
    await user.keyboard('{Escape}')
    await user.click(document.body)
    expect(dialog).toBeInTheDocument()
    expect(mocks.request).toHaveBeenCalledOnce()

    await act(async () =>
      saving.resolve(
        new Response(JSON.stringify({ ...createAccountResponse(), is_password_set: true })),
      ),
    )
    await waitFor(() => expect(mocks.get).toHaveBeenCalled())
    expect(cancel).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'common.operation.save' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await user.keyboard('{Escape}')
    expect(dialog).toBeInTheDocument()

    await act(async () =>
      refreshing.resolve(
        new Response(JSON.stringify({ ...createAccountResponse(), is_password_set: true })),
      ),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(
      screen.getByRole('button', { name: 'accountSettings.account.resetPassword' }),
    ).toBeInTheDocument()
    const request = mocks.request.mock.calls[0]?.[2]?.request as Request
    await expect(request.json()).resolves.toEqual({
      password: '',
      new_password: 'NewPassword123',
      repeat_new_password: 'NewPassword123',
    })
  })

  it('does not offer password editing when password login is disabled', () => {
    renderPage({ passwordLoginEnabled: false })
    expect(
      screen.queryByRole('button', { name: 'accountSettings.account.setPassword' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'accountSettings.account.resetPassword' }),
    ).not.toBeInTheDocument()
  })
})
