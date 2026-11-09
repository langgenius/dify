import type { Credential } from '../../types'
import { TooltipProvider } from '@langgenius/dify-ui/tooltip'
import { useState } from 'react'
import { render } from 'vitest-browser-react'
import { PermissionLevel } from '@/models/permission'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { AuthCategory, CredentialTypeEnum } from '../../types'
import WorkspaceConnectionSelector from '../workspace-connection-selector'

const mocks = vi.hoisted(() => ({
  consoleCall: vi.fn(),
  openOAuthPopup: vi.fn(),
}))

vi.mock('@/service/console/browser', () => ({
  consoleBrowserLink: {
    call: (...args: unknown[]) => mocks.consoleCall(...args),
  },
}))

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
          invalidPluginCredentialInfo: () => setCredentials(serverCredentials),
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
  mocks.openOAuthPopup.mockReset()
  mocks.consoleCall.mockImplementation(async (path: string[]) => {
    if (path.slice(-3).join('.') === 'oauth.clientSchema.get')
      return {
        schema: [],
        is_system_oauth_params_exists: true,
        is_oauth_custom_client_enabled: false,
        client_params: {},
        redirect_uri: 'https://example.com/oauth/callback',
      }
    if (path.slice(-3).join('.') === 'schema.byCredentialType.get')
      return [
        { name: 'api_key', label: { en_US: 'API Key' }, type: 'secret-input', required: true },
      ]
    if (path.slice(-2).join('.') === 'add.post') {
      serverCredentials = [...serverCredentials, createdApi]
      return creationIncludesId ? { result: 'success', id: createdApi.id } : { result: 'success' }
    }
    if (path.slice(-2).join('.') === 'authorizationUrl.get')
      return { authorization_url: 'https://example.com/oauth/authorize' }
    throw new Error(`Unexpected Console operation: ${path.join('.')}`)
  })
})

it.each([true, false])(
  'uses only the created API key identity returned by the server (includes ID: %s)',
  async (includesId) => {
    creationIncludesId = includesId
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

it('selects the exact OAuth connection returned by the completed authorization', async () => {
  mocks.openOAuthPopup.mockImplementation((_url, callback) => {
    serverCredentials = [...serverCredentials, createdOAuth]
    callback({ type: 'oauth_callback', success: true, connectionId: createdOAuth.id })
  })
  const onSelect = vi.fn()
  const screen = await showSelector(onSelect)
  await screen.getByRole('button', { name: /Existing connection/ }).click()
  await screen.getByRole('button', { name: 'plugin.auth.addOAuth' }).click()
  await screen.getByRole('button', { name: 'plugin.auth.authorize' }).click()

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
