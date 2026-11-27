import type { Credential } from '../../types'
import { TooltipProvider } from '@langgenius/dify-ui/tooltip'
import { useState } from 'react'
import { render } from 'vitest-browser-react'
import { PermissionLevel } from '@/models/permission'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { setupFakeApi } from '@/test/fake-api'
import { AuthCategory, CredentialTypeEnum } from '../../types'
import WorkspaceConnectionSelector from '../workspace-connection-selector'

const mocks = vi.hoisted(() => ({
  openOAuthPopup: vi.fn(),
}))

// boundary: replaces the external OAuth window while keeping credential selection real.
vi.mock('@/hooks/use-oauth', () => ({ openOAuthPopup: mocks.openOAuthPopup }))

const pluginPayload = { category: AuthCategory.tool, provider: 'test-provider' }
const existing: Credential = {
  id: 'existing',
  name: 'Existing connection',
  provider: pluginPayload.provider,
  credential_type: CredentialTypeEnum.API_KEY,
  is_default: false,
  visibility: PermissionLevel.onlyMe,
}
const createdApi: Credential = {
  ...existing,
  id: 'new-api',
  name: 'New API key',
}
const createdOAuth: Credential = {
  ...existing,
  id: 'new-oauth',
  name: 'New OAuth account',
  credential_type: CredentialTypeEnum.OAUTH2,
}
let serverCredentials: Credential[]
let creationIncludesId: boolean
let refreshRequest: ReturnType<typeof createDeferred<void>> | undefined
const refreshStarted = vi.fn()

const fake = setupFakeApi({
  console: {
    oauth: {
      plugin: {
        byProvider: {
          tool: {
            authorizationUrl: {
              get: () => ({ authorization_url: 'https://example.com/oauth/authorize' }),
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
                clientSchema: {
                  get: () => ({
                    schema: [],
                    is_system_oauth_params_exists: true,
                    is_oauth_custom_client_enabled: false,
                    client_params: {},
                    redirect_uri: 'https://example.com/oauth/callback',
                  }),
                },
              },
              credential: {
                schema: {
                  byCredentialType: {
                    get: () => [
                      {
                        name: 'api_key',
                        label: { en_US: 'API Key' },
                        type: 'secret-input',
                        required: true,
                      },
                    ],
                  },
                },
              },
              add: {
                post: () => {
                  serverCredentials = [...serverCredentials, createdApi]
                  return { result: 'success', id: creationIncludesId ? createdApi.id : '' }
                },
              },
            },
          },
        },
      },
    },
  },
})

async function showSelector(onSelect: (id: string) => void) {
  const { wrapper: Wrapper } = createConsoleQueryWrapper({
    accountProfile: { id: 'current-user' },
    workspacePermissionKeys: ['credential.use', 'credential.create', 'credential.manage'],
  })
  function ControlledSelector() {
    const [credentialId, setCredentialId] = useState(existing.id)
    const [credentials, setCredentials] = useState(serverCredentials)
    return (
      <WorkspaceConnectionSelector
        variant="inline"
        pluginPayload={pluginPayload}
        useWorkspaceDefault={false}
        credentialId={credentialId}
        authorization={{
          isAuthorized: true,
          canOAuth: true,
          canApiKey: true,
          isLoading: false,
          credentials,
          notAllowCustomCredential: false,
          invalidPluginCredentialInfo: async () => {
            refreshStarted()
            await refreshRequest?.promise
            setCredentials(serverCredentials)
          },
        }}
        onAuthorizationItemClick={(id) => {
          setCredentialId(id)
          onSelect(id)
        }}
      />
    )
  }
  return render(
    <Wrapper>
      <TooltipProvider>
        <ControlledSelector />
      </TooltipProvider>
    </Wrapper>,
  )
}

beforeEach(() => {
  serverCredentials = [existing]
  creationIncludesId = true
  refreshRequest = undefined
  refreshStarted.mockClear()
  mocks.openOAuthPopup.mockReset()
})

it.each([true, false])(
  'refreshes the available API keys before using the created identity (includes ID: %s)',
  async (includesId) => {
    creationIncludesId = includesId
    const refresh = createDeferred()
    refreshRequest = refresh
    const onSelect = vi.fn()
    const screen = await showSelector(onSelect)
    await screen.getByRole('button', { name: /Existing connection/ }).click()
    await screen.getByRole('button', { name: 'plugin.auth.common.addApiKey' }).click()
    const modal = screen.getByRole('dialog', { name: 'plugin.auth.useApiAuth' })
    await modal.getByLabelText(/API Key/).fill('new-secret')
    await modal
      .getByRole('textbox', { name: 'plugin.auth.authorizationName' })
      .fill(createdApi.name)
    await modal.getByRole('button', { name: 'common.operation.save' }).click()

    try {
      await expect.poll(() => refreshStarted.mock.calls.length).toBe(1)
      expect(onSelect).not.toHaveBeenCalled()
      await expect.element(modal).toBeVisible()
      await expect.element(screen.getByText('plugin.auth.authRemoved')).not.toBeInTheDocument()
      await expect.element(screen.getByText('plugin.auth.unavailable')).not.toBeInTheDocument()
    } finally {
      refresh.resolve()
    }

    await expect.element(modal).not.toBeInTheDocument()
    if (includesId) {
      expect(onSelect).toHaveBeenCalledExactlyOnceWith(createdApi.id)
      await expect.element(screen.getByRole('button', { name: /New API key/ })).toBeVisible()
    } else {
      expect(onSelect).not.toHaveBeenCalled()
      await expect
        .element(screen.getByRole('button', { name: /Existing connection/ }))
        .toBeVisible()
    }
  },
)

it('refreshes the available OAuth accounts before selecting the completed authorization', async () => {
  const refresh = createDeferred()
  refreshRequest = refresh
  mocks.openOAuthPopup.mockImplementation((_url, callback) => {
    serverCredentials = [...serverCredentials, createdOAuth]
    callback({ type: 'oauth_callback', success: true, connectionId: createdOAuth.id })
    callback()
  })
  const onSelect = vi.fn()
  const screen = await showSelector(onSelect)
  await screen.getByRole('button', { name: /Existing connection/ }).click()
  await screen.getByRole('button', { name: 'plugin.auth.addOAuth' }).click()
  await screen.getByRole('button', { name: 'plugin.auth.authorize' }).click()

  try {
    await expect.poll(() => refreshStarted.mock.calls.length).toBe(1)
    expect(onSelect).not.toHaveBeenCalled()
    await expect.element(screen.getByRole('button', { name: /Existing connection/ })).toBeVisible()
    await expect.element(screen.getByText('plugin.auth.authRemoved')).not.toBeInTheDocument()
    await expect.element(screen.getByText('plugin.auth.unavailable')).not.toBeInTheDocument()
  } finally {
    refresh.resolve()
  }

  await expect.element(screen.getByRole('button', { name: /New OAuth account/ })).toBeVisible()
  expect(onSelect).toHaveBeenCalledExactlyOnceWith(createdOAuth.id)
})

it('preserves the existing selection when the OAuth popup closes without a completed connection', async () => {
  mocks.openOAuthPopup.mockImplementation((_url, callback) => callback())
  const onSelect = vi.fn()
  const screen = await showSelector(onSelect)
  await screen.getByRole('button', { name: /Existing connection/ }).click()
  await screen.getByRole('button', { name: 'plugin.auth.addOAuth' }).click()
  await screen.getByRole('button', { name: 'plugin.auth.authorize' }).click()

  await expect
    .element(screen.getByRole('dialog', { name: 'plugin.auth.whoCanUse' }))
    .not.toBeInTheDocument()
  expect(onSelect).not.toHaveBeenCalled()
  await expect.element(screen.getByRole('button', { name: /Existing connection/ })).toBeVisible()
})

it('does not repeat a successful API key creation when refreshing its list fails', async () => {
  const refresh = createDeferred()
  refreshRequest = refresh
  const onSelect = vi.fn()
  const screen = await showSelector(onSelect)
  await screen.getByRole('button', { name: /Existing connection/ }).click()
  await screen.getByRole('button', { name: 'plugin.auth.common.addApiKey' }).click()
  const modal = screen.getByRole('dialog', { name: 'plugin.auth.useApiAuth' })
  await modal.getByLabelText(/API Key/).fill('new-secret')
  await modal.getByRole('button', { name: 'common.operation.save' }).click()
  await expect.poll(() => refreshStarted.mock.calls.length).toBe(1)
  refresh.reject(new Error('Connection list could not be loaded'))

  await expect.element(modal).not.toBeInTheDocument()
  expect(onSelect).not.toHaveBeenCalled()
  await expect.element(screen.getByRole('button', { name: /Existing connection/ })).toBeVisible()
  expect(
    fake.console.workspaces.current.toolProvider.builtin.byProvider.add.post,
  ).toHaveBeenCalledOnce()
})
