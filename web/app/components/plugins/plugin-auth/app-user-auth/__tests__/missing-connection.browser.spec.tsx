import type { Credential } from '../../types'
import type { AppUserAuthDraft } from '../draft'
import { TooltipProvider } from '@langgenius/dify-ui/tooltip'
import { useState } from 'react'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { setupFakeApi } from '@/test/fake-api'
import AppUserAuth from '..'
import { AuthCategory, CredentialTypeEnum } from '../../types'
import { createAppUserAuthDraft } from '../draft'

setupFakeApi({
  console: {
    workspaces: {
      current: {
        toolProvider: {
          builtin: {
            byProvider: { credential: { schema: { byCredentialType: { get: () => [] } } } },
          },
        },
      },
    },
  },
})

it('explains a removed test connection and lets the user replace it with an available connection', async () => {
  const { queryClient, wrapper: Providers } = createConsoleQueryWrapper({
    workspacePermissionKeys: ['credential.use'],
  })
  onTestFinished(() => queryClient.clear())
  const pluginPayload = { category: AuthCategory.tool, provider: 'test-provider' }
  const available: Credential = {
    id: 'available-key',
    name: 'Available API key',
    provider: pluginPayload.provider,
    credential_type: CredentialTypeEnum.API_KEY,
    is_default: false,
  }
  function ControlledAppUserAuth() {
    const [draft, setDraft] = useState<AppUserAuthDraft>(() => ({
      ...createAppUserAuthDraft({ canOAuth: false }),
      description: 'Use your account',
      testCredentialId: 'removed-key',
    }))
    return (
      <AppUserAuth
        pluginPayload={pluginPayload}
        value={draft}
        onChange={setDraft}
        authorization={{
          isAuthorized: true,
          canOAuth: false,
          canApiKey: true,
          isLoading: false,
          notAllowCustomCredential: true,
          credentials: [available],
          invalidPluginCredentialInfo: vi.fn(),
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
  const connection = screen.getByRole('region', { name: 'plugin.auth.appUser.testConnection' })
  const removed = connection.getByRole('button', {
    name: /plugin.auth.appUser.testConnectionRemoved/,
  })
  await expect.element(removed).toBeVisible()
  await removed.click()
  const picker = screen.getByRole('dialog', { name: 'plugin.auth.authorization' })
  await picker.getByRole('button', { name: /^Available API key/ }).click()
  await expect.element(connection.getByRole('button', { name: /^Available API key/ })).toBeVisible()
  await expect.element(removed).not.toBeInTheDocument()
})
