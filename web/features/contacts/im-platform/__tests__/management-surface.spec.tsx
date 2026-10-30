import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { consoleQuery } from '@/service/console'
import { ContactsImPlatformRuntimeProvider } from '../composition'
import { ContactsImPlatformManagementSurface } from '../management-surface'
import { channelSummary, emailDetail } from './fixtures/channel-client'
import { channel, defaultResponse, json, providers, syncRun } from './fixtures/http'

const network = vi.hoisted(() => ({
  handle: vi.fn<(request: Request) => Promise<Response> | Response>(),
}))
vi.mock('@/service/base', async () => {
  const { httpErrorFromResponse } = await import('@/service/http-error')
  return {
    request: async (_url: string, _init: RequestInit, options: { request: Request }) => {
      const response = await network.handle(options.request)
      if (!response.ok) throw await httpErrorFromResponse(response)
      return response
    },
  }
})
vi.mock('@/utils/client', () => ({ isClient: true, isServer: false }))
vi.mock('@/context/i18n', async (original) => ({
  ...(await original<typeof import('@/context/i18n')>()),
  useDocLink: () => (path: string) => `https://docs.dify.ai${path}`,
}))
const clients: QueryClient[] = []
function renderSurface(canManage = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  clients.push(client)
  render(
    <QueryClientProvider client={client}>
      <NuqsTestingAdapter>
        <ContactsImPlatformRuntimeProvider
          organization={{ canManage, organizationId: 'workspace-1', workspaceId: 'workspace-1' }}
        >
          <ContactsImPlatformManagementSurface />
        </ContactsImPlatformRuntimeProvider>
      </NuqsTestingAdapter>
    </QueryClientProvider>,
  )
  return client
}
const calls = (ending: string, method = 'GET') =>
  network.handle.mock.calls
    .map(([request]) => request)
    .filter(
      (request) => new URL(request.url).pathname.endsWith(ending) && request.method === method,
    )
beforeEach(() => {
  network.handle.mockImplementation(defaultResponse)
})
afterEach(() => clients.splice(0).forEach((client) => client.clear()))

it('loads the generated summary once without fetching every channel detail', async () => {
  renderSurface()
  expect(await screen.findByRole('group', { name: 'Feishu' })).toHaveTextContent('saved-tenant')
  expect(calls('/channels')).toHaveLength(1)
  expect(calls('/channel-providers')).toHaveLength(1)
  expect(calls('/channels/im/channel-1')).toHaveLength(0)
})

it('does not fetch or expose channels to a non-manager', () => {
  renderSurface(false)
  expect(screen.queryByRole('group', { name: 'Feishu' })).not.toBeInTheDocument()
  expect(network.handle).not.toHaveBeenCalled()
})

it('uses saved redacted metadata for an update and keeps generated cache invalidation', async () => {
  const user = userEvent.setup()
  const client = renderSurface()
  await user.click(
    await screen.findByRole('button', { name: /contacts\.imPlatform\.action\.configureChannel/ }),
  )
  const dialog = await screen.findByRole('dialog')
  await user.click(
    within(dialog).getByRole('button', { name: 'contacts.imPlatform.bindingDialog.back' }),
  )
  const appId = await within(dialog).findByLabelText(
    'contacts.imPlatform.bindingDialog.field.appId',
  )
  await user.clear(appId)
  await user.type(appId, 'updated-app')
  await user.click(
    within(dialog).getByRole('button', {
      name: 'contacts.imPlatform.bindingDialog.saveAndContinue',
    }),
  )
  await waitFor(() => expect(calls('/channels/im/channel-1', 'PUT')).toHaveLength(1))
  const request = calls('/channels/im/channel-1', 'PUT')[0]
  if (!request) throw new Error('Expected the saved channel request')
  const payload = await request.json()
  expect(payload).toMatchObject({
    credentials: { app_id: 'updated-app', app_secret: { type: 'unchanged' } },
    expected_config_version: channel.config_version,
  })
  await waitFor(() => expect(calls('/channels').length).toBeGreaterThan(1))
  expect(
    client.getQueryData(consoleQuery.workspaces.current.humanInput.v2.channels.get.queryKey()),
  ).toEqual({ channels: [channel] })
})

it('keeps corrected credentials after a rejected save', async () => {
  network.handle.mockImplementation((request) =>
    request.method === 'PUT'
      ? json({ code: 'bad_request', message: 'Invalid credentials' }, 400)
      : defaultResponse(request),
  )
  const user = userEvent.setup()
  renderSurface()
  await user.click(
    await screen.findByRole('button', { name: /contacts\.imPlatform\.action\.configureChannel/ }),
  )
  const dialog = await screen.findByRole('dialog')
  await user.click(
    within(dialog).getByRole('button', { name: 'contacts.imPlatform.bindingDialog.back' }),
  )
  const secret = await within(dialog).findByLabelText(
    'contacts.imPlatform.bindingDialog.field.secret',
  )
  await user.type(secret, 'retry-secret')
  await user.click(
    within(dialog).getByRole('button', {
      name: 'contacts.imPlatform.bindingDialog.saveAndContinue',
    }),
  )
  expect(await within(dialog).findByRole('alert')).toBeInTheDocument()
  expect(secret).toHaveValue('retry-secret')
})

it('confirms tenant replacement once and includes the saved identity in its title', async () => {
  network.handle.mockImplementation((request) => {
    if (request.method === 'PUT')
      return json(
        {
          code: 'replacement_required',
          message: 'Replace tenant',
          current_config_version: channel.config_version,
        },
        409,
      )
    if (request.url.endsWith('/replacement')) return json({ summary: channel })
    return defaultResponse(request)
  })
  const user = userEvent.setup()
  renderSurface()
  await user.click(
    await screen.findByRole('button', { name: /contacts\.imPlatform\.action\.configureChannel/ }),
  )
  const dialog = await screen.findByRole('dialog')
  await user.click(
    within(dialog).getByRole('button', { name: 'contacts.imPlatform.bindingDialog.back' }),
  )
  const app = await within(dialog).findByLabelText('contacts.imPlatform.bindingDialog.field.appId')
  await user.clear(app)
  await user.type(app, 'different-tenant')
  await user.click(
    within(dialog).getByRole('button', {
      name: 'contacts.imPlatform.bindingDialog.saveAndContinue',
    }),
  )
  const confirmation = await screen.findByRole('alertdialog')
  expect(confirmation).toHaveAccessibleName(
    /contacts\.imPlatform\.bindingDialog\.replaceTenantTitle.*saved-tenant/,
  )
  await user.click(
    within(confirmation).getByRole('button', { name: 'contacts.imPlatform.replacement.confirm' }),
  )
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  await user.type(
    within(dialog).getByLabelText('contacts.imPlatform.bindingDialog.field.secret'),
    'fresh-secret',
  )
  await user.click(
    within(dialog).getByRole('button', {
      name: 'contacts.imPlatform.bindingDialog.saveAndContinue',
    }),
  )
  await waitFor(() => expect(calls('/replacement', 'POST')).toHaveLength(1))
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
})

it('clears an unsaved credential session after closing and reopening', async () => {
  const user = userEvent.setup()
  renderSurface()
  const configure = await screen.findByRole('button', {
    name: /contacts\.imPlatform\.action\.configureChannel/,
  })
  await user.click(configure)
  const dialog = await screen.findByRole('dialog')
  await user.click(
    within(dialog).getByRole('button', { name: 'contacts.imPlatform.bindingDialog.back' }),
  )
  const app = await within(dialog).findByLabelText('contacts.imPlatform.bindingDialog.field.appId')
  await user.clear(app)
  await user.type(app, 'unsaved')
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await user.click(configure)
  const reopened = await screen.findByRole('dialog')
  await user.click(
    within(reopened).getByRole('button', { name: 'contacts.imPlatform.bindingDialog.back' }),
  )
  expect(
    await within(reopened).findByLabelText('contacts.imPlatform.bindingDialog.field.appId'),
  ).toHaveValue('app-1')
})

it('renders Email provider as static text and gives changing actions stable names', async () => {
  const email = channelSummary({ id: 'channel-email', kind: 'email', provider: 'resend' })
  network.handle.mockImplementation((request) => {
    if (request.url.endsWith('/channels')) return json({ channels: [email] })
    if (request.url.endsWith('/channel-providers')) return json(providers)
    if (request.url.endsWith('/channels/email/channel-email')) return json(emailDetail(email))
    return defaultResponse(request)
  })
  const user = userEvent.setup()
  renderSurface()
  await user.click(
    await screen.findByRole('button', { name: /contacts\.imPlatform\.action\.configureChannel/ }),
  )
  const dialog = await screen.findByRole('dialog')
  expect(await within(dialog).findByText('Resend')).toBeVisible()
  expect(
    within(dialog).queryByRole('textbox', { name: 'contacts.imPlatform.email.provider' }),
  ).not.toBeInTheDocument()
  expect(
    within(dialog).getByRole('button', { name: 'contacts.imPlatform.action.save' }),
  ).toHaveAttribute('aria-labelledby')
  expect(within(dialog).getByRole('status')).toBeEmptyDOMElement()
})

it('keeps sync action focused while the server run is queued', async () => {
  network.handle.mockImplementation((request) =>
    request.method === 'POST' && request.url.endsWith('/im-sync-runs')
      ? json({ run: syncRun({ status: 'queued', finished_at: null }) })
      : defaultResponse(request),
  )
  const user = userEvent.setup()
  renderSurface()
  const button = await screen.findByRole('button', { name: 'contacts.imPlatform.action.syncNow' })
  await waitFor(() => expect(button).toBeEnabled())
  await user.click(button)
  expect(
    await screen.findByRole('button', { name: 'contacts.imPlatform.action.syncing' }),
  ).toHaveFocus()
  expect(button).toHaveAttribute('aria-disabled', 'true')
})

it('does not invalidate completed sync data merely when opening the surface', async () => {
  const client = renderSurface()
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  await screen.findByRole('button', { name: 'contacts.imPlatform.action.syncNow' })
  await waitFor(() => expect(calls('/im-sync-runs/latest')).toHaveLength(1))
  expect(invalidate).not.toHaveBeenCalled()
})

it('shows a version conflict without offering a destructive tenant replacement', async () => {
  network.handle.mockImplementation((request) =>
    request.method === 'PUT'
      ? json(
          { code: 'provider_configuration_updated', message: 'Configuration changed', status: 409 },
          409,
        )
      : defaultResponse(request),
  )
  const user = userEvent.setup()
  renderSurface()
  await user.click(
    await screen.findByRole('button', { name: /contacts\.imPlatform\.action\.configureChannel/ }),
  )
  const dialog = await screen.findByRole('dialog')
  await user.click(
    within(dialog).getByRole('button', { name: 'contacts.imPlatform.bindingDialog.back' }),
  )
  await user.type(
    await within(dialog).findByLabelText('contacts.imPlatform.bindingDialog.field.appId'),
    '-changed',
  )
  await user.click(
    within(dialog).getByRole('button', {
      name: 'contacts.imPlatform.bindingDialog.saveAndContinue',
    }),
  )
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    'contacts.imPlatform.configurationUpdated',
  )
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  expect(calls('/replacement', 'POST')).toHaveLength(0)
})

it('allows starting the first sync after the generated latest endpoint returns 404', async () => {
  network.handle.mockImplementation((request) =>
    request.url.endsWith('/latest')
      ? json({ code: 'not_found', message: 'No sync yet' }, 404)
      : defaultResponse(request),
  )
  renderSurface()
  const button = await screen.findByRole('button', { name: 'contacts.imPlatform.action.syncNow' })
  await waitFor(() => expect(button).toBeEnabled())
  expect(await screen.findByText('contacts.imPlatform.sync.noRuns')).toBeVisible()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('refreshes related generated caches on an actual running-to-terminal transition', async () => {
  const client = renderSurface()
  await screen.findByRole('button', { name: 'contacts.imPlatform.action.viewDetails' })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const latestKey = consoleQuery.workspaces.current.humanInput.v2.imSyncRuns.latest.get.queryKey()
  await act(async () => {
    client.setQueryData(latestKey, {
      run: syncRun({ id: 'new-run', status: 'running', finished_at: null }),
    })
  })
  await screen.findByRole('button', { name: 'contacts.imPlatform.action.syncing' })
  expect(invalidate).not.toHaveBeenCalled()
  await act(async () => {
    client.setQueryData(latestKey, { run: syncRun({ id: 'new-run', status: 'succeeded' }) })
  })
  await waitFor(() =>
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: consoleQuery.workspaces.current.humanInput.v2.contacts.key(),
    }),
  )
})

it('continues to saved callbacks without rewriting unchanged credentials', async () => {
  const user = userEvent.setup()
  renderSurface()
  await user.click(
    await screen.findByRole('button', { name: /contacts\.imPlatform\.action\.configureChannel/ }),
  )
  const dialog = await screen.findByRole('dialog')
  await user.click(
    within(dialog).getByRole('button', { name: 'contacts.imPlatform.bindingDialog.back' }),
  )
  await user.click(
    await within(dialog).findByRole('button', {
      name: 'contacts.imPlatform.bindingDialog.saveAndContinue',
    }),
  )
  expect(
    await within(dialog).findByLabelText('contacts.imPlatform.bindingDialog.callback'),
  ).toHaveValue(channel.webhook_url)
  expect(calls('/channels/im/channel-1', 'PUT')).toHaveLength(0)
})

it('does not retain failed-save secrets in Query mutation variables', async () => {
  network.handle.mockImplementation((request) =>
    request.method === 'PUT'
      ? json({ code: 'bad_request', message: 'Invalid credentials' }, 400)
      : defaultResponse(request),
  )
  const user = userEvent.setup()
  const client = renderSurface()
  await user.click(
    await screen.findByRole('button', { name: /contacts\.imPlatform\.action\.configureChannel/ }),
  )
  const dialog = await screen.findByRole('dialog')
  await user.click(
    within(dialog).getByRole('button', { name: 'contacts.imPlatform.bindingDialog.back' }),
  )
  await user.type(
    await within(dialog).findByLabelText('contacts.imPlatform.bindingDialog.field.secret'),
    'private-retry-secret',
  )
  await user.click(
    within(dialog).getByRole('button', {
      name: 'contacts.imPlatform.bindingDialog.saveAndContinue',
    }),
  )
  await within(dialog).findByRole('alert')
  expect(
    JSON.stringify(
      client
        .getMutationCache()
        .getAll()
        .map((mutation) => mutation.state.variables),
    ),
  ).not.toContain('private-retry-secret')
})
