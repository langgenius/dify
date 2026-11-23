import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { installFakeApi, route } from '@/test/fake-api'
import PluginAuthInAgent from '../plugin-auth-in-agent'
import { createCredential, credentialInfo, pluginPayload } from './credential-fixtures'

type CredentialInfo = ReturnType<typeof credentialInfo>

function AgentCredential({ initialId }: { initialId?: string }) {
  const [credentialId, setCredentialId] = useState(initialId)
  return (
    <PluginAuthInAgent
      pluginPayload={pluginPayload}
      credentialId={credentialId}
      onAuthorizationItemClick={setCredentialId}
    />
  )
}

async function setup(
  initialId?: string,
  info: CredentialInfo | Promise<CredentialInfo> = credentialInfo(),
) {
  const { queryClient } = createConsoleQueryWrapper({
    workspacePermissionKeys: ['credential.use', 'credential.create', 'credential.manage'],
  })
  onTestFinished(() => queryClient.clear())
  onTestFinished(
    installFakeApi({
      console: {
        workspaces: {
          current: {
            toolProvider: {
              builtin: {
                byProvider: {
                  credential: {
                    schema: {
                      byCredentialType: {
                        get: () => [
                          {
                            type: 'secret-input',
                            name: 'api_key',
                            label: { en_US: 'API key' },
                            required: true,
                          },
                        ],
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      routes: [
        route(
          'GET',
          'console',
          '/workspaces/current/tool-provider/builtin/test-provider/credential/info',
          () => info,
        ),
      ],
    }),
  )
  return render(
    <QueryClientTestProvider queryClient={queryClient}>
      <AgentCredential initialId={initialId} />
    </QueryClientTestProvider>,
  )
}

it('opens API authorization when the provider has no credentials', async () => {
  await setup(undefined, credentialInfo([]))
  const authorize = page.getByRole('button', { name: 'plugin.auth.useApiAuth' })
  await expect.element(authorize).toBeEnabled()
  authorize.element().focus()
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByRole('dialog')).toBeVisible()
  await expect
    .element(page.getByRole('textbox', { name: /plugin.auth.authorizationName/ }))
    .toBeVisible()
})

it('selects the workspace default instead of a named credential', async () => {
  await setup('credential-1')
  await page.getByRole('button', { name: 'Team API key', exact: true }).click()
  const popup = page.getByRole('dialog', { name: 'plugin.auth.authorizations' })
  await popup.getByText('plugin.auth.workspaceDefault', { exact: true }).click()
  await expect.element(popup).not.toBeInTheDocument()
  await expect
    .element(page.getByRole('button', { name: 'plugin.auth.workspaceDefault', exact: true }))
    .toBeVisible()
})

// https://github.com/langgenius/dify/issues/46384 — credential-info refetch unmounts the trigger.
it('keeps focus on the agent credential trigger after selecting a named key', async () => {
  await setup()
  const trigger = page.getByRole('button', { name: 'plugin.auth.workspaceDefault', exact: true })
  await expect.element(trigger).toBeVisible()
  trigger.element().focus()
  await userEvent.keyboard('{Enter}')
  const popup = page.getByRole('dialog', { name: 'plugin.auth.authorizations' })
  await expect.element(popup).toBeVisible()
  await popup.getByText('Team API key', { exact: true }).click()
  await expect.element(popup).not.toBeInTheDocument()
  const selected = page.getByRole('button', { name: 'Team API key', exact: true })
  await expect.element(selected).toBeVisible()
  await expect.element(selected).toHaveFocus()
})

it('replaces a removed credential without keeping the removed label', async () => {
  await setup('removed-key')
  await page.getByRole('button', { name: 'plugin.auth.authRemoved' }).click()
  const popup = page.getByRole('dialog', { name: 'plugin.auth.authorizations' })
  await popup.getByText('Team API key', { exact: true }).click()
  await expect.element(popup).not.toBeInTheDocument()
  await expect
    .element(page.getByRole('button', { name: 'Team API key', exact: true }))
    .toBeVisible()
  await expect.element(page.getByText('plugin.auth.authRemoved')).not.toBeInTheDocument()
})

it('keeps an unavailable selected credential visible but refuses to reselect it', async () => {
  await setup(
    'restricted',
    credentialInfo([
      createCredential({ id: 'restricted', name: 'Restricted key', not_allowed_to_use: true }),
      createCredential({ id: 'available', name: 'Available key', is_default: false }),
    ]),
  )
  const trigger = page.getByRole('button', { name: /Restricted key.*plugin.auth.unavailable/ })
  await trigger.click()
  const popup = page.getByRole('dialog', { name: 'plugin.auth.authorizations' })
  await popup.getByText('Restricted key', { exact: true }).click()
  await expect.element(popup).toBeVisible()
  await expect.element(trigger).toBeVisible()
  await popup.getByText('Available key', { exact: true }).click()
  await expect.element(popup).not.toBeInTheDocument()
  await expect
    .element(page.getByRole('button', { name: 'Available key', exact: true }))
    .toBeVisible()
})
