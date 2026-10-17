import type { DatasourceProviderAuthResponse } from '@dify/contracts/api/console/auth/types.gen'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormTypeEnum } from '@/app/components/base/form/types'
import { CredentialTypeEnum } from '@/app/components/plugins/plugin-auth/types'
import { openOAuthPopup } from '@/hooks/use-oauth'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import Card from '../card'

const { mockPost, mockGetPluginOAuthUrl } = vi.hoisted(() => ({
  mockPost: vi.fn(),
  mockGetPluginOAuthUrl: vi.fn(),
}))
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  post: (...args: unknown[]) => mockPost(...args),
}))
vi.mock('@/hooks/use-oauth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/use-oauth')>()),
  openOAuthPopup: vi.fn(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'oauth.plugin.byProviderId.datasource.getAuthorizationUrl.get': (input) =>
        mockGetPluginOAuthUrl(input),
    }),
  }
})

const item: DatasourceProviderAuthResponse = {
  author: 'Test Author',
  provider: 'test-provider',
  plugin_id: 'test-plugin-id',
  plugin_unique_identifier: 'test-author/test-name:1.2.0@checksum',
  icon: 'test-icon-url',
  name: 'test-name',
  label: { en_US: 'Test Label' },
  description: { en_US: 'Test Description' },
  credential_schema: [
    { name: 'apiKey', type: FormTypeEnum.textInput, label: { en_US: 'API Key' }, required: true },
  ],
  oauth_schema: null,
  credentials_list: [
    {
      id: 'c1',
      name: 'Credential 1',
      credential: { apiKey: 'key1' },
      type: CredentialTypeEnum.API_KEY,
      is_default: true,
      avatar_url: 'avatar1',
    },
  ],
}
const oauthItem: DatasourceProviderAuthResponse = {
  ...item,
  credentials_list: [{ ...item.credentials_list[0]!, type: CredentialTypeEnum.OAUTH2 }],
}
const providerId = 'test-plugin-id/test-name'
const endpoint = `/auth/plugin/datasource/${providerId}`
const renderCard = (
  data = item,
  permissions = ['credential.use', 'credential.create', 'credential.manage'],
  disabled = false,
) => {
  const queryClient = createConsoleQueryClient()
  const affectedKeys = [
    consoleQuery.auth.plugin.datasource.list.get.queryKey(),
    consoleQuery.auth.plugin.datasource.defaultList.get.queryKey(),
    consoleQuery.auth.plugin.datasource.byProviderId.get.queryKey({
      input: { params: { provider_id: providerId } },
    }),
    consoleQuery.rag.pipelines.datasourcePlugins.get.key(),
  ]
  for (const key of affectedKeys) queryClient.setQueryData(key, { data: [] })
  const view = renderWithConsoleQuery(<Card item={data} disabled={disabled} />, {
    queryClient,
    workspacePermissionKeys: permissions,
  })
  const expectInvalidated = () => {
    for (const key of affectedKeys) expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)
  }
  const expectFresh = () => {
    for (const key of affectedKeys)
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false)
  }
  return { ...view, expectInvalidated, expectFresh }
}
const openActions = async () =>
  userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'common.operation.more Credential 1' }))
const chooseAction = async (name: string | RegExp) => {
  await openActions()
  await userEvent.setup().click(await screen.findByRole('menuitem', { name }))
}

describe('Datasource Card', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPost.mockReset().mockResolvedValue({ result: 'success' })
    mockGetPluginOAuthUrl
      .mockReset()
      .mockResolvedValue({ authorization_url: 'https://oauth.example/authorize' })
  })

  it('identifies the provider and existing default credential', () => {
    renderCard()
    expect(screen.getByRole('heading', { name: 'Test Label' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Test Label' })).toHaveAttribute('src', 'test-icon-url')
    expect(screen.getByText('1.2.0')).toBeInTheDocument()
    expect(screen.getByText('Credential 1')).toBeInTheDocument()
    expect(screen.getByText('plugin.auth.default')).toBeInTheDocument()
  })

  it('shows the empty state when no credentials are connected', () => {
    renderCard({ ...item, credentials_list: [] })
    expect(screen.getByText('plugin.auth.emptyAuth')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /operation.more/ })).not.toBeInTheDocument()
  })

  it('edits an actual API-key form and invalidates datasource caches after success', async () => {
    const user = userEvent.setup()
    const pending = createDeferred<{ result: string }>()
    mockPost.mockReturnValueOnce(pending.promise)
    const { expectFresh, expectInvalidated } = renderCard()
    await chooseAction('common.operation.edit')
    const dialog = await screen.findByRole('dialog', { name: 'plugin.auth.useApiAuth' })
    expect(within(dialog).getByDisplayValue('Credential 1')).toBeInTheDocument()
    const keyInput = within(dialog).getByDisplayValue('key1')
    await user.clear(keyInput)
    await user.type(keyInput, 'new-key')
    const save = within(dialog).getByRole('button', { name: 'common.operation.save' })
    await user.click(save)
    expect(mockPost).toHaveBeenCalledExactlyOnceWith(`${endpoint}/update`, {
      body: { credential_id: 'c1', name: 'Credential 1', credentials: { apiKey: 'new-key' } },
    })
    expect(save).toBeDisabled()
    expectFresh()
    await act(async () => pending.resolve({ result: 'success' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expectInvalidated()
  })

  it('cancels editing without sending a credential update', async () => {
    const user = userEvent.setup()
    const { expectFresh } = renderCard()
    await chooseAction('common.operation.edit')
    await user.click(await screen.findByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mockPost).not.toHaveBeenCalled()
    expectFresh()
  })

  it('requires delete confirmation and waits for completion before invalidating', async () => {
    const user = userEvent.setup()
    const pending = createDeferred<{ result: string }>()
    mockPost.mockReturnValueOnce(pending.promise)
    const { expectFresh, expectInvalidated } = renderCard()
    await chooseAction('common.operation.remove')
    await user.click(await screen.findByRole('button', { name: 'common.operation.cancel' }))
    expect(mockPost).not.toHaveBeenCalled()
    await chooseAction('common.operation.remove')
    const confirm = await screen.findByRole('button', { name: 'common.operation.confirm' })
    await user.click(confirm)
    await user.click(confirm)
    expect(confirm).toBeDisabled()
    expect(mockPost).toHaveBeenCalledExactlyOnceWith(`${endpoint}/delete`, {
      body: { credential_id: 'c1' },
    })
    expectFresh()
    await act(async () => pending.resolve({ result: 'success' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expectInvalidated()
  })

  it('sets a default credential with use permission and blocks management actions', async () => {
    const user = userEvent.setup()
    const { expectInvalidated } = renderCard(oauthItem, ['credential.use'])
    await chooseAction('plugin.auth.setDefault')
    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledExactlyOnceWith(`${endpoint}/default`, {
        body: { id: 'c1' },
      }),
    )
    await waitFor(expectInvalidated)
    await openActions()
    for (const name of [
      'common.operation.rename',
      'common.operation.remove',
      'common.dataSource.notion.changeAuthorizedPages',
    ]) {
      const action = screen.getByRole('menuitem', { name })
      expect(action).toHaveAttribute('aria-disabled', 'true')
      await user.click(action)
    }
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(mockGetPluginOAuthUrl).not.toHaveBeenCalled()
    expect(mockPost).toHaveBeenCalledTimes(1)
  })

  it('blocks credential operations without use or manage permission', async () => {
    const user = userEvent.setup()
    renderCard(item, [])
    await openActions()
    for (const name of [
      'plugin.auth.setDefault',
      'common.operation.edit',
      'common.operation.remove',
    ]) {
      const action = screen.getByRole('menuitem', { name })
      expect(action).toHaveAttribute('aria-disabled', 'true')
      await user.click(action)
    }
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('renames OAuth credentials through the inline editor', async () => {
    const user = userEvent.setup()
    const { expectInvalidated } = renderCard(oauthItem)
    await chooseAction('common.operation.rename')
    const input = await screen.findByRole('textbox', {
      name: 'common.operation.rename Credential 1',
    })
    expect(input).toHaveFocus()
    await user.clear(input)
    await user.type(input, 'New Name')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledExactlyOnceWith(`${endpoint}/update`, {
        body: { credential_id: 'c1', name: 'New Name' },
      }),
    )
    await waitFor(expectInvalidated)
  })

  it('starts OAuth for the selected credential and refreshes caches only after completion', async () => {
    const { expectFresh, expectInvalidated } = renderCard(oauthItem)
    await chooseAction('common.dataSource.notion.changeAuthorizedPages')
    await waitFor(() =>
      expect(openOAuthPopup).toHaveBeenCalledExactlyOnceWith(
        'https://oauth.example/authorize',
        expect.any(Function),
      ),
    )
    expect(mockGetPluginOAuthUrl).toHaveBeenCalledExactlyOnceWith({
      params: { provider_id: providerId },
      query: { credential_id: 'c1' },
    })
    expectFresh()
    act(() => vi.mocked(openOAuthPopup).mock.calls[0]![1]?.())
    expectInvalidated()
  })

  it('keeps the current authorization if no OAuth URL is returned', async () => {
    mockGetPluginOAuthUrl.mockResolvedValueOnce({ authorization_url: '' })
    const { expectFresh } = renderCard(oauthItem)
    await chooseAction('common.dataSource.notion.changeAuthorizedPages')
    await waitFor(() => expect(mockGetPluginOAuthUrl).toHaveBeenCalledTimes(1))
    expect(openOAuthPopup).not.toHaveBeenCalled()
    expectFresh()
  })

  it('creates an API key through Configure and refreshes the datasource list', async () => {
    const user = userEvent.setup()
    const { expectInvalidated } = renderCard({ ...item, credentials_list: [] })
    await user.click(screen.getByRole('button', { name: 'common.dataSource.configure Test Label' }))
    await user.click(await screen.findByRole('button', { name: 'plugin.auth.addApi' }))
    const dialog = await screen.findByRole('dialog', { name: 'plugin.auth.useApiAuth' })
    const inputs = within(dialog).getAllByRole('textbox')
    await user.type(inputs[0]!, 'New key')
    await user.type(inputs[1]!, 'secret')
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))
    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledExactlyOnceWith(endpoint, {
        body: expect.objectContaining({
          name: 'New key',
          credentials: { apiKey: 'secret' },
          type: CredentialTypeEnum.API_KEY,
        }),
      }),
    )
    await waitFor(expectInvalidated)
  })

  it('prevents credential creation without create permission', async () => {
    const user = userEvent.setup()
    renderCard(item, ['credential.use'])
    await user.click(screen.getByRole('button', { name: 'common.dataSource.configure Test Label' }))
    const add = await screen.findByRole('button', { name: 'plugin.auth.addApi' })
    expect(add).toBeDisabled()
    await user.click(add)
    expect(screen.queryByRole('dialog', { name: 'plugin.auth.addApi' })).not.toBeInTheDocument()
    expect(mockPost).not.toHaveBeenCalled()
  })
})
