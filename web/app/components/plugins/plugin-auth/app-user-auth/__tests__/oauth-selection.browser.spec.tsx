import type { Credential } from '../../types'
import type { AppUserAuthDraft } from '../draft'
import type { openOAuthPopup } from '@/hooks/use-oauth'
import type { consoleClient } from '@/service/console'
import { TooltipProvider } from '@langgenius/dify-ui/tooltip'
import { useState } from 'react'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { setupFakeApi } from '@/test/fake-api'
import AppUserAuth from '..'
import { AuthCategory, CredentialTypeEnum } from '../../types'
import { createAppUserAuthDraft } from '../draft'

type OAuthClientSchema = Awaited<
  ReturnType<
    typeof consoleClient.workspaces.current.toolProvider.builtin.byProvider.oauth.clientSchema.get
  >
>

const mocks = vi.hoisted(() => ({
  openOAuthPopup: vi.fn<typeof openOAuthPopup>(),
  refresh: vi.fn(),
  draftChanged: vi.fn<(draft: AppUserAuthDraft) => void>(),
}))

// boundary: the external OAuth popup completes independently of this component's page.
vi.mock('@/hooks/use-oauth', () => ({ openOAuthPopup: mocks.openOAuthPopup }))

const pluginPayload = { category: AuthCategory.tool, provider: 'test-provider' }
const createdOAuth: Credential = {
  id: 'new-oauth',
  name: 'New OAuth account',
  provider: pluginPayload.provider,
  credential_type: CredentialTypeEnum.OAUTH2,
  is_default: false,
}
let serverClient: OAuthClientSchema
let serverCredentials: Credential[]
let refreshRequest: ReturnType<typeof createDeferred<void>> | undefined

setupFakeApi({
  console: {
    oauth: {
      plugin: {
        byProvider: {
          tool: {
            authorizationUrl: {
              get: () => ({ authorization_url: 'https://example.com/authorize' }),
            },
          },
        },
      },
    },
    workspaces: {
      current: {
        toolProvider: {
          builtin: {
            byProvider: {
              oauth: {
                clientSchema: { get: () => serverClient },
                customClient: {
                  post: ({ body }) => {
                    serverClient = {
                      ...serverClient,
                      is_oauth_custom_client_enabled: body.enable_oauth_custom_client ?? false,
                      client_params: { ...body.client_params, client_secret: '[__HIDDEN__]' },
                    }
                    return { result: 'success' }
                  },
                },
              },
            },
          },
        },
      },
    },
  },
})

async function showAppUserAuth() {
  const { queryClient, wrapper: Providers } = createConsoleQueryWrapper({
    workspacePermissionKeys: ['credential.use', 'credential.create', 'credential.manage'],
  })
  onTestFinished(() => queryClient.clear())
  function ControlledAppUserAuth() {
    const [draft, setDraft] = useState(() => ({
      ...createAppUserAuthDraft({ canApiKey: false }),
      description: 'Original purpose',
    }))
    const [credentials, setCredentials] = useState(serverCredentials)
    return (
      <AppUserAuth
        pluginPayload={pluginPayload}
        providerName="Example provider"
        value={draft}
        onChange={(next) => {
          setDraft(next)
          mocks.draftChanged(next)
        }}
        authorization={{
          isAuthorized: credentials.length > 0,
          canOAuth: true,
          canApiKey: false,
          isLoading: false,
          notAllowCustomCredential: false,
          credentials,
          invalidPluginCredentialInfo: async (options) => {
            mocks.refresh(options)
            await refreshRequest?.promise
            setCredentials(serverCredentials)
          },
        }}
      />
    )
  }
  const screen = await render(
    <Providers>
      <TooltipProvider>
        <ControlledAppUserAuth />
      </TooltipProvider>
    </Providers>,
  )
  return screen
}

async function startAuthorization(screen: Awaited<ReturnType<typeof showAppUserAuth>>) {
  await screen.getByRole('button', { name: 'plugin.auth.common.configureClient' }).click()
  const settings = screen.getByRole('dialog', { name: 'plugin.auth.oauthClientSettings' })
  await settings.getByRole('textbox', { name: 'Client ID' }).fill('client-id')
  await settings.getByLabelText('Client Secret', { exact: false }).fill('client-secret')
  await settings.getByRole('button', { name: 'plugin.auth.saveAndAuth' }).click()
  const permissions = screen.getByRole('dialog', { name: 'plugin.auth.whoCanUse' })
  await permissions.getByRole('button', { name: 'plugin.auth.authorize' }).click()
  await expect.poll(() => mocks.openOAuthPopup.mock.calls.length).toBe(1)
  await expect.element(permissions).not.toBeInTheDocument()
  const call = mocks.openOAuthPopup.mock.calls[0]
  if (!call) throw new Error('Expected the OAuth popup to open')
  return call[1]
}

beforeEach(() => {
  serverClient = {
    schema: [
      {
        name: 'client_id',
        label: { en_US: 'Client ID' },
        type: 'text-input',
        required: true,
        multiple: false,
      },
      {
        name: 'client_secret',
        label: { en_US: 'Client Secret' },
        type: 'secret-input',
        required: true,
        multiple: false,
      },
    ],
    is_oauth_custom_client_enabled: false,
    is_system_oauth_params_exists: false,
    client_params: {},
    redirect_uri: 'https://example.com/oauth/callback',
  }
  serverCredentials = []
  refreshRequest = undefined
  mocks.openOAuthPopup.mockReset()
  mocks.refresh.mockClear()
  mocks.draftChanged.mockClear()
})

it('selects the completed OAuth account after refreshing and preserves edits made while its popup is open', async () => {
  const screen = await showAppUserAuth()
  const complete = await startAuthorization(screen)
  const description = screen.getByRole('textbox', {
    name: 'plugin.auth.appUser.connectionDescription',
  })
  await description.fill('Purpose edited while authorizing')
  const refresh = createDeferred()
  refreshRequest = refresh
  serverCredentials = [createdOAuth]
  mocks.refresh.mockClear()
  complete({ type: 'oauth_callback', success: true, connectionId: createdOAuth.id })
  complete()
  const testConnection = screen.getByRole('region', { name: 'plugin.auth.appUser.testConnection' })
  try {
    await expect.poll(() => mocks.refresh.mock.calls.length).toBeGreaterThan(0)
    await expect
      .element(
        testConnection.getByRole('button', {
          name: 'plugin.auth.appUser.testConnectionPlaceholder',
        }),
      )
      .toBeVisible()
    expect(
      mocks.draftChanged.mock.calls.some(([draft]) => draft.testCredentialId === createdOAuth.id),
    ).toBe(false)
  } finally {
    refresh.resolve()
  }
  await expect
    .element(testConnection.getByRole('button', { name: /New OAuth account/ }))
    .toBeVisible()
  expect(mocks.refresh).toHaveBeenCalledTimes(1)
  await expect.element(description).toHaveValue('Purpose edited while authorizing')
  await expect
    .element(screen.getByRole('button', { name: 'plugin.auth.appUser.customClient' }))
    .toBeVisible()
  expect(
    mocks.draftChanged.mock.calls.filter(([draft]) => draft.testCredentialId === createdOAuth.id),
  ).toHaveLength(1)
})

it('leaves the test connection unselected when the OAuth popup closes without a completed account', async () => {
  const screen = await showAppUserAuth()
  const complete = await startAuthorization(screen)
  mocks.refresh.mockClear()
  complete()
  await expect.poll(() => mocks.refresh.mock.calls.length).toBe(1)
  await expect
    .element(
      screen
        .getByRole('region', { name: 'plugin.auth.appUser.testConnection' })
        .getByRole('button', { name: 'plugin.auth.appUser.testConnectionPlaceholder' }),
    )
    .toBeVisible()
  expect(
    mocks.draftChanged.mock.calls.every(([draft]) => draft.testCredentialId === undefined),
  ).toBe(true)
})
