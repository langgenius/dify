import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { createDeferred } from '@/test/deferred'
import { installFakeApi, route } from '@/test/fake-api'
import AuthorizedInNode from '../authorized-in-node'
import { createCredential, credentialInfo, pluginPayload } from './credential-fixtures'

type CredentialInfo = ReturnType<typeof credentialInfo>

function NodeCredential({ initialId }: { initialId?: string }) {
  const [credentialId, setCredentialId] = useState(initialId)
  return (
    <AuthorizedInNode
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
  const { queryClient } = createConsoleQueryWrapper({ workspacePermissionKeys: ['credential.use'] })
  onTestFinished(() => queryClient.clear())
  onTestFinished(
    installFakeApi({
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
      <NodeCredential initialId={initialId} />
    </QueryClientTestProvider>,
  )
}

it('switches a selected credential back to the workspace default and returns focus to the trigger', async () => {
  await setup('credential-1')
  const trigger = page.getByRole('button', { name: 'Team API key', exact: true })
  await expect.element(trigger).toBeVisible()
  trigger.element().focus()
  await userEvent.keyboard('{Enter}')
  const popup = page.getByRole('dialog', { name: 'plugin.auth.authorizations' })
  await expect.element(popup).toBeVisible()
  await popup.getByText('plugin.auth.workspaceDefault', { exact: true }).click()
  await expect.element(popup).not.toBeInTheDocument()
  await expect
    .element(page.getByRole('button', { name: 'plugin.auth.workspaceDefault', exact: true }))
    .toHaveFocus()
})

it('waits for credential info before reporting a removed selection and lets the user replace it', async () => {
  const request = createDeferred<CredentialInfo>()
  await setup('removed-key', request.promise)
  await expect.element(page.getByRole('button', { name: 'common.loading' })).toBeVisible()
  await expect.element(page.getByText('plugin.auth.authRemoved')).not.toBeInTheDocument()
  request.resolve(credentialInfo())
  await page.getByRole('button', { name: 'plugin.auth.authRemoved' }).click()
  const popup = page.getByRole('dialog', { name: 'plugin.auth.authorizations' })
  await popup.getByText('Team API key', { exact: true }).click()
  await expect.element(popup).not.toBeInTheDocument()
  await expect
    .element(page.getByRole('button', { name: 'Team API key', exact: true }))
    .toHaveFocus()
})

it.each([
  {
    label: 'selected key',
    initialId: 'unavailable',
    credential: { id: 'unavailable', is_default: false, not_allowed_to_use: true },
  },
  { label: 'workspace default', initialId: undefined, credential: { not_allowed_to_use: true } },
])(
  'keeps an unavailable $label from being selected while allowing a replacement',
  async ({ initialId, credential }) => {
    await setup(
      initialId,
      credentialInfo([
        createCredential({ name: 'Restricted key', ...credential }),
        createCredential({ id: 'replacement', name: 'Available key', is_default: false }),
      ]),
    )
    const trigger = page.getByRole('button', { name: /plugin.auth.unavailable/ })
    await trigger.click()
    const popup = page.getByRole('dialog', { name: 'plugin.auth.authorizations' })
    await popup.getByText('Restricted key', { exact: true }).click()
    await expect.element(popup).toBeVisible()
    await expect.element(trigger).toBeVisible()
    if (!initialId) {
      await popup.getByText('plugin.auth.workspaceDefault', { exact: true }).click()
      await expect.element(popup).toBeVisible()
    }
    await popup.getByText('Available key', { exact: true }).click()
    await expect.element(popup).not.toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: 'Available key', exact: true }))
      .toHaveFocus()
  },
)

it('shows the missing workspace default as unavailable without hiding usable named credentials', async () => {
  await setup(undefined, credentialInfo([createCredential({ is_default: false })]))
  await page
    .getByRole('button', { name: /plugin.auth.workspaceDefault.*plugin.auth.unavailable/ })
    .click()
  const popup = page.getByRole('dialog', { name: 'plugin.auth.authorizations' })
  await popup.getByText('Team API key', { exact: true }).click()
  await expect.element(popup).not.toBeInTheDocument()
  await expect
    .element(page.getByRole('button', { name: 'Team API key', exact: true }))
    .toHaveFocus()
})
