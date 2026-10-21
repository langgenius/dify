import type { ComponentProps } from 'react'
import type { Credential } from '../../types'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { FormTypeEnum } from '@/app/components/base/form/types'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { AuthCategory, CredentialTypeEnum } from '../../types'
import Authorized from '../index'

const requests = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('@/service/base', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/base')>()
  return {
    ...actual,
    request: async (url: string, _init: RequestInit, options: { request: Request }) => {
      const path = new URL(url).pathname.replace('/console/api', '')
      return Response.json(
        options.request.method === 'GET'
          ? await requests.get(path)
          : await requests.post(path, { body: await options.request.json() }),
      )
    },
  }
})
const permissions = vi.hoisted(() => ({
  keys: ['credential.use', 'credential.create', 'credential.manage'],
}))
vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({ workspacePermissionKeys: permissions.keys }))
})

const baseUrl = '/workspaces/current/tool-provider/builtin/test-provider'
const payload = { category: AuthCategory.tool, provider: 'test-provider' }
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
const trigger = () => screen.getByRole('button', { name: /plugin.auth.authorization/ })
const confirmDialog = () =>
  screen.findByRole('alertdialog', { name: 'datasetDocuments.list.delete.title' })
const editDialog = () => screen.findByRole('dialog', { name: 'plugin.auth.useApiAuth' })
const renderAuthorized = (props: Partial<ComponentProps<typeof Authorized>> = {}) =>
  renderWithConsoleQuery(<Authorized {...defaults} {...props} />)

beforeEach(() => {
  vi.clearAllMocks()
  permissions.keys = ['credential.use', 'credential.create', 'credential.manage']
  requests.post.mockResolvedValue({})
  requests.get.mockImplementation((url: string) => {
    if (url.endsWith('/credential/schema/api-key'))
      return Promise.resolve([
        {
          name: 'api_key',
          label: { en_US: 'API Key' },
          type: FormTypeEnum.secretInput,
          required: true,
        },
      ])
    if (url.endsWith('/oauth/client-schema'))
      return Promise.resolve({
        schema: [],
        is_oauth_custom_client_enabled: false,
        is_system_oauth_params_exists: true,
      })
    throw new Error(`Unexpected credential request: ${url}`)
  })
})

describe('Authorized credential management', () => {
  it('groups API keys and OAuth credentials, reports unavailable entries, and selects the workspace default', async () => {
    const user = userEvent.setup()
    const onItemClick = vi.fn()
    renderAuthorized({
      credentials: [
        credential(),
        credential({
          id: 'oauth',
          name: 'OAuth account',
          credential_type: CredentialTypeEnum.OAUTH2,
          not_allowed_to_use: true,
        }),
      ],
      extraAuthorizationItems: [
        credential({ id: '__workspace_default__', name: 'Workspace default' }),
      ],
      onItemClick,
      disableSetDefault: true,
    })
    expect(trigger()).toHaveTextContent('2 plugin.auth.authorizations (1 plugin.auth.unavailable)')
    await user.click(trigger())
    expect(await screen.findByText('API Keys')).toBeInTheDocument()
    expect(screen.getByText('OAuth')).toBeInTheDocument()
    await user.click(screen.getByText('OAuth account'))
    expect(onItemClick).not.toHaveBeenCalled()
    await user.click(screen.getByText('Primary key'))
    expect(onItemClick).toHaveBeenLastCalledWith('credential-a')
    await user.click(screen.getByText('Workspace default'))
    expect(onItemClick).toHaveBeenLastCalledWith('')
    expect(screen.queryByRole('button', { name: 'plugin.auth.setDefault' })).not.toBeInTheDocument()
  })

  it('uses the controlled open state and reports dismissal to its owner', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const props = {
      ...defaults,
      onOpenChange,
      renderTrigger: (open: boolean, triggerProps: React.ComponentPropsWithRef<'button'>) => (
        <button {...triggerProps} type="button">
          {open ? 'Hide credentials' : 'Show credentials'}
        </button>
      ),
    }
    const { rerender } = renderWithConsoleQuery(<Authorized {...props} isOpen />)
    await user.click(screen.getByRole('button', { name: 'Hide credentials' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    rerender(<Authorized {...props} isOpen={false} />)
    await waitFor(() => expect(screen.queryByText('API Keys')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Show credentials' })).toBeInTheDocument()
  })

  it('cancels one deletion, then deletes the newly selected credential only once while pending', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()
    const pending = createDeferred<object>()
    requests.post.mockReturnValue(pending.promise)
    const { rerender } = renderAuthorized({ onUpdate })
    await user.click(trigger())
    await user.click(await screen.findByRole('button', { name: 'common.operation.delete' }))
    await user.click(
      within(await confirmDialog()).getByRole('button', { name: 'common.operation.cancel' }),
    )
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(requests.post).not.toHaveBeenCalled()
    rerender(
      <Authorized
        {...defaults}
        credentials={[credential({ id: 'credential-b', name: 'Backup key' })]}
        onUpdate={onUpdate}
      />,
    )
    await user.click(trigger())
    await user.click(await screen.findByRole('button', { name: 'common.operation.delete' }))
    const confirm = within(await confirmDialog()).getByRole('button', {
      name: 'common.operation.confirm',
    })
    await user.click(confirm)
    expect(confirm).toBeDisabled()
    await user.click(confirm)
    await waitFor(() =>
      expect(requests.post).toHaveBeenCalledExactlyOnceWith(`${baseUrl}/delete`, {
        body: { credential_id: 'credential-b' },
      }),
    )
    expect(onUpdate).not.toHaveBeenCalled()
    await act(async () => {
      pending.resolve({})
    })
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(onUpdate).toHaveBeenCalledOnce()
  })

  it('serializes set-default operations and allows another action after completion', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()
    const pending = createDeferred<object>()
    requests.post.mockReturnValueOnce(pending.promise)
    renderAuthorized({ onUpdate })
    await user.click(trigger())
    const setDefault = await screen.findByRole('button', { name: 'plugin.auth.setDefault' })
    await user.click(setDefault)
    await user.click(setDefault)
    await waitFor(() =>
      expect(requests.post).toHaveBeenCalledExactlyOnceWith(`${baseUrl}/default-credential`, {
        body: { id: 'credential-a' },
      }),
    )
    expect(onUpdate).not.toHaveBeenCalled()
    await act(async () => {
      pending.resolve({})
    })
    await waitFor(() => expect(onUpdate).toHaveBeenCalledOnce())
    await user.click(setDefault)
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(2))
    expect(requests.post).toHaveBeenCalledTimes(2)
  })

  it('renames OAuth credentials and ignores another save until the first update completes', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()
    const pending = createDeferred<object>()
    requests.post.mockReturnValueOnce(pending.promise)
    renderAuthorized({
      credentials: [credential({ credential_type: CredentialTypeEnum.OAUTH2 })],
      onUpdate,
    })
    await user.click(trigger())
    await user.click(await screen.findByRole('button', { name: 'common.operation.rename' }))
    const name = screen.getByRole('textbox', { name: 'common.operation.rename' })
    await user.clear(name)
    await user.type(name, 'Renamed account')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    await user.click(screen.getByRole('button', { name: 'common.operation.rename' }))
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    await waitFor(() =>
      expect(requests.post).toHaveBeenCalledExactlyOnceWith(`${baseUrl}/update`, {
        body: { credential_id: 'credential-a', name: 'Renamed account' },
      }),
    )
    expect(onUpdate).not.toHaveBeenCalled()
    await act(async () => {
      pending.resolve({})
    })
    await waitFor(() => expect(onUpdate).toHaveBeenCalledOnce())
  })

  it('reopens the edit form for a different credential with its own values and deletion target', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()
    const { rerender } = renderAuthorized({ onUpdate })
    await user.click(trigger())
    await user.click(await screen.findByRole('button', { name: 'common.operation.edit' }))
    const first = await editDialog()
    expect(await within(first).findByLabelText(/API Key/)).toHaveValue('first-secret')
    await user.clear(within(first).getByRole('textbox', { name: 'plugin.auth.authorizationName' }))
    await user.type(
      within(first).getByRole('textbox', { name: 'plugin.auth.authorizationName' }),
      'Unsaved name',
    )
    await user.click(within(first).getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    rerender(
      <Authorized
        {...defaults}
        credentials={[
          credential({
            id: 'credential-b',
            name: 'Backup key',
            credentials: { api_key: 'second-secret' },
          }),
        ]}
        onUpdate={onUpdate}
      />,
    )
    await user.click(trigger())
    await user.click(await screen.findByRole('button', { name: 'common.operation.edit' }))
    const second = await editDialog()
    expect(await within(second).findByLabelText(/API Key/)).toHaveValue('second-secret')
    expect(
      within(second).getByRole('textbox', { name: 'plugin.auth.authorizationName' }),
    ).toHaveValue('Backup key')
    await user.click(within(second).getByRole('button', { name: 'common.operation.remove' }))
    await user.click(
      within(await confirmDialog()).getByRole('button', { name: 'common.operation.confirm' }),
    )
    await waitFor(() => expect(onUpdate).toHaveBeenCalledOnce())
    expect(requests.post).toHaveBeenCalledExactlyOnceWith(`${baseUrl}/delete`, {
      body: { credential_id: 'credential-b' },
    })
  })

  it('saves edited key values with their credential identity', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()
    renderAuthorized({ onUpdate })
    await user.click(trigger())
    await user.click(await screen.findByRole('button', { name: 'common.operation.edit' }))
    const modal = await editDialog()
    const key = await within(modal).findByLabelText(/API Key/)
    await user.clear(key)
    await user.type(key, 'replacement-secret')
    await user.click(within(modal).getByRole('button', { name: 'common.operation.save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(requests.post).toHaveBeenCalledExactlyOnceWith(`${baseUrl}/update`, {
      body: {
        credential_id: 'credential-a',
        name: 'Primary key',
        credentials: { api_key: 'replacement-secret' },
      },
    })
    expect(onUpdate).toHaveBeenCalledOnce()
  })

  it('keeps the add-key dialog usable after its credential popover closes', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()
    renderAuthorized({ credentials: [], canApiKey: true, onUpdate })
    await user.click(trigger())
    await user.click(await screen.findByRole('button', { name: 'plugin.auth.useApiAuth' }))
    const modal = await editDialog()
    await user.type(await within(modal).findByLabelText(/API Key/), 'new-secret')
    await user.click(within(modal).getByRole('button', { name: 'common.operation.save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(requests.post).toHaveBeenCalledWith(`${baseUrl}/add`, {
      body: {
        credentials: { api_key: 'new-secret' },
        type: CredentialTypeEnum.API_KEY,
        name: '',
        visibility: 'all_team_members',
      },
    })
    expect(onUpdate).toHaveBeenCalledOnce()
  })

  it.each([
    { keys: ['credential.use'], canUse: true, canManage: false, canCreate: false },
    { keys: ['credential.manage'], canUse: false, canManage: true, canCreate: false },
    { keys: ['credential.create'], canUse: false, canManage: false, canCreate: true },
    { keys: [], canUse: false, canManage: false, canCreate: false },
  ])(
    'respects independent credential permissions: $keys',
    async ({ keys, canUse, canManage, canCreate }) => {
      const user = userEvent.setup()
      permissions.keys = keys
      renderAuthorized({ canApiKey: true })
      await user.click(trigger())
      const setDefault = await screen.findByRole('button', { name: 'plugin.auth.setDefault' })
      expect(setDefault.hasAttribute('disabled')).toBe(!canUse)
      expect(
        screen.getByRole('button', { name: 'common.operation.edit' }).hasAttribute('disabled'),
      ).toBe(!canManage)
      expect(
        screen.getByRole('button', { name: 'common.operation.delete' }).hasAttribute('disabled'),
      ).toBe(!canManage)
      expect(
        screen.getByRole('button', { name: 'plugin.auth.useApiAuth' }).hasAttribute('disabled'),
      ).toBe(!canCreate)
      await user.click(setDefault)
      expect(requests.post).toHaveBeenCalledTimes(canUse ? 1 : 0)
    },
  )

  it('omits creation actions when custom credentials are disallowed', async () => {
    const user = userEvent.setup()
    renderAuthorized({ canApiKey: true, canOAuth: true, notAllowCustomCredential: true })
    await user.click(trigger())
    await screen.findByText('API Keys')
    expect(screen.queryByRole('button', { name: 'plugin.auth.addApi' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /plugin.auth.addOAuth/ })).not.toBeInTheDocument()
  })
})
