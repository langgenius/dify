import type { ComponentProps } from 'react'
import type { Credential } from '../../types'
import type { consoleClient } from '@/service/console'
import { useState } from 'react'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { AppToaster } from '@/app/notifications/app-toaster'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { AuthCategory, CredentialTypeEnum } from '../../types'
import Authorized from '../index'

const api = vi.hoisted(() => ({
  remove:
    vi.fn<typeof consoleClient.workspaces.current.toolProvider.builtin.byProvider.delete.post>(),
  update:
    vi.fn<typeof consoleClient.workspaces.current.toolProvider.builtin.byProvider.update.post>(),
  add: vi.fn<typeof consoleClient.workspaces.current.toolProvider.builtin.byProvider.add.post>(),
  setDefault:
    vi.fn<
      typeof consoleClient.workspaces.current.toolProvider.builtin.byProvider.defaultCredential.post
    >(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.toolProvider.builtin.byProvider.delete.post': api.remove,
      'workspaces.current.toolProvider.builtin.byProvider.update.post': api.update,
      'workspaces.current.toolProvider.builtin.byProvider.add.post': api.add,
      'workspaces.current.toolProvider.builtin.byProvider.defaultCredential.post': api.setDefault,
      'workspaces.current.toolProvider.builtin.byProvider.credential.schema.byCredentialType.get':
        async () => [
          { name: 'api_key', label: { en_US: 'API Key' }, type: 'secret-input', required: true },
        ],
      'workspaces.current.toolProvider.builtin.byProvider.oauth.clientSchema.get': async () => ({
        schema: [],
        is_oauth_custom_client_enabled: false,
        is_system_oauth_params_exists: true,
      }),
    }),
  }
})

const payload = { category: AuthCategory.tool, provider: 'test-provider' }
const params = { provider: 'test-provider' }
const credential = (overrides: Partial<Credential> = {}): Credential => ({
  id: 'credential-a',
  name: 'Primary key',
  provider: 'test-provider',
  credential_type: CredentialTypeEnum.API_KEY,
  is_default: false,
  credentials: { api_key: 'first-secret' },
  ...overrides,
})
const defaults = { pluginPayload: payload, credentials: [credential()] }
const trigger = () => page.getByRole('button', { name: /plugin.auth.authorization/ })
const confirmation = () =>
  page.getByRole('alertdialog', { name: 'datasetDocuments.list.delete.title' })
const editor = () => page.getByRole('dialog', { name: 'plugin.auth.useApiAuth' })
const allPermissions = ['credential.use', 'credential.create', 'credential.manage']

async function setup(
  props: Partial<ComponentProps<typeof Authorized>> = {},
  keys = allPermissions,
) {
  const { queryClient, wrapper: Providers } = createConsoleQueryWrapper({
    workspacePermissionKeys: keys,
  })
  onTestFinished(() => queryClient.clear())
  const ui = (next: Partial<ComponentProps<typeof Authorized>>) => (
    <Providers>
      <Authorized {...defaults} {...next} />
      <AppToaster />
    </Providers>
  )
  const screen = await render(ui(props))
  return {
    rerender: (next: Partial<ComponentProps<typeof Authorized>>) => screen.rerender(ui(next)),
  }
}

beforeEach(() => {
  api.remove.mockReset().mockResolvedValue({ result: 'success' })
  api.update.mockReset().mockResolvedValue({ result: 'success' })
  api.add.mockReset().mockResolvedValue({ result: 'success' })
  api.setDefault.mockReset().mockResolvedValue({ result: 'success' })
})

it('selects usable credentials or the workspace default while leaving unavailable accounts unselected', async () => {
  function Selection() {
    const [selected, setSelected] = useState('Unselected')
    return (
      <>
        <Authorized
          {...defaults}
          credentials={[
            credential(),
            credential({
              id: 'oauth',
              name: 'OAuth account',
              credential_type: CredentialTypeEnum.OAUTH2,
              not_allowed_to_use: true,
            }),
          ]}
          extraAuthorizationItems={[
            credential({ id: '__workspace_default__', name: 'Workspace default' }),
          ]}
          onItemClick={setSelected}
          disableSetDefault
        />
        <output aria-label="Selected credential">{selected || 'Workspace default'}</output>
      </>
    )
  }
  const { queryClient, wrapper: Providers } = createConsoleQueryWrapper({
    workspacePermissionKeys: allPermissions,
  })
  onTestFinished(() => queryClient.clear())
  await render(
    <Providers>
      <Selection />
    </Providers>,
  )
  await expect
    .element(trigger())
    .toHaveTextContent('2 plugin.auth.authorizations (1 plugin.auth.unavailable)')
  await trigger().click()
  await expect.element(page.getByText('API Keys', { exact: true })).toBeVisible()
  await expect.element(page.getByText('OAuth', { exact: true })).toBeVisible()
  await page.getByText('OAuth account', { exact: true }).click()
  await expect
    .element(page.getByRole('status', { name: 'Selected credential' }))
    .toHaveTextContent('Unselected')
  await page.getByText('Primary key', { exact: true }).click()
  await expect
    .element(page.getByRole('status', { name: 'Selected credential' }))
    .toHaveTextContent('credential-a')
  await page.getByText('Workspace default', { exact: true }).click()
  await expect
    .element(page.getByRole('status', { name: 'Selected credential' }))
    .toHaveTextContent('Workspace default')
  await expect
    .element(page.getByRole('button', { name: 'plugin.auth.setDefault' }))
    .not.toBeInTheDocument()
})

it('closes a controlled credential popover through its custom trigger', async () => {
  function Controlled() {
    const [open, setOpen] = useState(true)
    return (
      <Authorized
        {...defaults}
        isOpen={open}
        onOpenChange={setOpen}
        renderTrigger={(isOpen, props) => (
          <button {...props} type="button">
            {isOpen ? 'Hide credentials' : 'Show credentials'}
          </button>
        )}
      />
    )
  }
  const { queryClient, wrapper: Providers } = createConsoleQueryWrapper({
    workspacePermissionKeys: allPermissions,
  })
  onTestFinished(() => queryClient.clear())
  await render(
    <Providers>
      <Controlled />
    </Providers>,
  )
  await expect.element(page.getByText('API Keys', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Hide credentials' }).click()
  await expect.element(page.getByText('API Keys', { exact: true })).not.toBeInTheDocument()
  await expect.element(page.getByRole('button', { name: 'Show credentials' })).toHaveFocus()
})

it('cancels one deletion and confirms the new credential once after the owner changes its list', async () => {
  const pending =
    createDeferred<
      Awaited<
        ReturnType<
          typeof consoleClient.workspaces.current.toolProvider.builtin.byProvider.delete.post
        >
      >
    >()
  api.remove.mockReturnValue(pending.promise)
  const { rerender } = await setup()
  await trigger().click()
  await page.getByRole('button', { name: 'common.operation.delete' }).click()
  await confirmation().getByRole('button', { name: 'common.operation.cancel' }).click()
  await expect.element(confirmation()).not.toBeInTheDocument()
  expect(api.remove).not.toHaveBeenCalled()
  await rerender({ credentials: [credential({ id: 'credential-b', name: 'Backup key' })] })
  await trigger().click()
  await page.getByRole('button', { name: 'common.operation.delete' }).click()
  const confirm = confirmation().getByRole('button', { name: 'common.operation.confirm' })
  await confirm.click()
  await expect.element(confirm).toBeDisabled()
  expect(api.remove).toHaveBeenCalledExactlyOnceWith({
    params,
    body: { credential_id: 'credential-b' },
  })
  pending.resolve({ result: 'success' })
  await expect.element(confirmation()).not.toBeInTheDocument()
  await expect.element(page.getByText('common.api.actionSuccess', { exact: true })).toBeVisible()
})

it('serializes default-credential requests and accepts another action after completion', async () => {
  const pending =
    createDeferred<
      Awaited<
        ReturnType<
          typeof consoleClient.workspaces.current.toolProvider.builtin.byProvider.defaultCredential.post
        >
      >
    >()
  api.setDefault.mockReturnValueOnce(pending.promise)
  await setup()
  await trigger().click()
  const setDefault = page.getByRole('button', { name: 'plugin.auth.setDefault' })
  await setDefault.click()
  await setDefault.click()
  expect(api.setDefault).toHaveBeenCalledExactlyOnceWith({ params, body: { id: 'credential-a' } })
  pending.resolve({ result: 'success' })
  await expect.element(page.getByText('common.api.actionSuccess', { exact: true })).toBeVisible()
  await setDefault.click()
  await expect.poll(() => api.setDefault.mock.calls.length).toBe(2)
})

it('submits an OAuth credential rename once until its update completes', async () => {
  const pending =
    createDeferred<
      Awaited<
        ReturnType<
          typeof consoleClient.workspaces.current.toolProvider.builtin.byProvider.update.post
        >
      >
    >()
  api.update.mockReturnValueOnce(pending.promise)
  await setup({ credentials: [credential({ credential_type: CredentialTypeEnum.OAUTH2 })] })
  await trigger().click()
  await page.getByRole('button', { name: 'common.operation.rename' }).click()
  await page.getByRole('textbox', { name: 'common.operation.rename' }).fill('Renamed account')
  await page.getByRole('button', { name: 'common.operation.save' }).click()
  await page.getByRole('button', { name: 'common.operation.rename' }).click()
  await page.getByRole('button', { name: 'common.operation.save' }).click()
  expect(api.update).toHaveBeenCalledExactlyOnceWith({
    params,
    body: { credential_id: 'credential-a', name: 'Renamed account' },
  })
  pending.resolve({ result: 'success' })
  await expect.element(page.getByText('common.api.actionSuccess', { exact: true })).toBeVisible()
})

it('discards an old edit draft and removes the credential opened in the new session', async () => {
  const { rerender } = await setup()
  await trigger().click()
  await page.getByRole('button', { name: 'common.operation.edit' }).click()
  await expect.element(editor().getByLabelText(/API Key/)).toHaveValue('first-secret')
  await editor()
    .getByRole('textbox', { name: 'plugin.auth.authorizationName' })
    .fill('Unsaved name')
  await editor().getByRole('button', { name: 'common.operation.cancel' }).click()
  await expect.element(editor()).not.toBeInTheDocument()
  await rerender({
    credentials: [
      credential({
        id: 'credential-b',
        name: 'Backup key',
        credentials: { api_key: 'second-secret' },
      }),
    ],
  })
  await trigger().click()
  await page.getByRole('button', { name: 'common.operation.edit' }).click()
  await expect.element(editor().getByLabelText(/API Key/)).toHaveValue('second-secret')
  await expect
    .element(editor().getByRole('textbox', { name: 'plugin.auth.authorizationName' }))
    .toHaveValue('Backup key')
  await editor().getByRole('button', { name: 'common.operation.remove' }).click()
  await confirmation().getByRole('button', { name: 'common.operation.confirm' }).click()
  await expect.element(confirmation()).not.toBeInTheDocument()
  expect(api.remove).toHaveBeenCalledExactlyOnceWith({
    params,
    body: { credential_id: 'credential-b' },
  })
})

it('saves edited key values with the credential identity after its popover closes', async () => {
  await setup()
  await trigger().click()
  await page.getByRole('button', { name: 'common.operation.edit' }).click()
  await editor()
    .getByLabelText(/API Key/)
    .fill('replacement-secret')
  await editor().getByRole('button', { name: 'common.operation.save' }).click()
  await expect.element(editor()).not.toBeInTheDocument()
  expect(api.update).toHaveBeenCalledExactlyOnceWith({
    params,
    body: {
      credential_id: 'credential-a',
      name: 'Primary key',
      credentials: { api_key: 'replacement-secret' },
    },
  })
})

it('creates a key through the dialog that outlives its credential popover', async () => {
  await setup({ credentials: [], canApiKey: true })
  await trigger().click()
  await page.getByRole('button', { name: 'plugin.auth.useApiAuth' }).click()
  await editor()
    .getByLabelText(/API Key/)
    .fill('new-secret')
  await editor().getByRole('button', { name: 'common.operation.save' }).click()
  await expect.element(editor()).not.toBeInTheDocument()
  expect(api.add).toHaveBeenCalledExactlyOnceWith({
    params,
    body: {
      credentials: { api_key: 'new-secret' },
      type: CredentialTypeEnum.API_KEY,
      name: '',
      visibility: 'all_team_members',
    },
  })
})

it.each([
  { keys: ['credential.use'], canUse: true, canManage: false, canCreate: false },
  { keys: ['credential.manage'], canUse: false, canManage: true, canCreate: false },
  { keys: ['credential.create'], canUse: false, canManage: false, canCreate: true },
  { keys: [], canUse: false, canManage: false, canCreate: false },
])(
  'honors independently granted credential permissions: $keys',
  async ({ keys, canUse, canManage, canCreate }) => {
    await setup({ canApiKey: true }, keys)
    await trigger().click()
    const setDefault = page.getByRole('button', { name: 'plugin.auth.setDefault' })
    for (const [control, allowed] of [
      [setDefault, canUse],
      [page.getByRole('button', { name: 'common.operation.edit' }), canManage],
      [page.getByRole('button', { name: 'common.operation.delete' }), canManage],
      [page.getByRole('button', { name: 'plugin.auth.useApiAuth' }), canCreate],
    ] as const) {
      if (allowed) await expect.element(control).toBeEnabled()
      else await expect.element(control).toBeDisabled()
    }
    if (canUse) {
      await setDefault.click()
      expect(api.setDefault).toHaveBeenCalledExactlyOnceWith({
        params,
        body: { id: 'credential-a' },
      })
    } else expect(api.setDefault).not.toHaveBeenCalled()
  },
)

it('omits creation actions when the provider disallows custom credentials', async () => {
  await setup({ canApiKey: true, canOAuth: true, notAllowCustomCredential: true })
  await trigger().click()
  await expect.element(page.getByText('API Keys', { exact: true })).toBeVisible()
  await expect
    .element(page.getByRole('button', { name: 'plugin.auth.addApi' }))
    .not.toBeInTheDocument()
  await expect
    .element(page.getByRole('button', { name: /plugin.auth.addOAuth/ }))
    .not.toBeInTheDocument()
})
