import type { Credential } from '../../types'
import { createDropdownMenuHandle } from '@langgenius/dify-ui/dropdown-menu'
import { TooltipProvider } from '@langgenius/dify-ui/tooltip'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { PermissionLevel } from '@/models/permission'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { AuthCategory, CredentialTypeEnum } from '../../types'
import ConnectionActions, { ConnectionActionsTrigger } from '../connection-actions'

const mocks = vi.hoisted(() => ({
  consoleCall: vi.fn(),
  addCredential: vi.fn(),
  updateCredential: vi.fn(),
}))

vi.mock('@/service/console/browser', () => ({
  consoleBrowserLink: {
    call: (...args: unknown[]) => mocks.consoleCall(...args),
  },
}))

vi.mock('../../hooks/use-credential', () => ({
  useGetPluginCredentialSchemaHook: () => ({
    data: [{ name: 'api_key', label: 'API Key', type: 'secret-input', required: true }],
    isLoading: false,
  }),
  useAddPluginCredentialHook: () => ({ mutateAsync: mocks.addCredential }),
  useUpdatePluginCredentialHook: () => ({ mutateAsync: mocks.updateCredential }),
}))

vi.mock('@/app/notifications', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const pluginPayload = { category: AuthCategory.tool, provider: 'test-provider' }
const createCredential = (overrides: Partial<Credential> = {}): Credential => ({
  id: 'workspace-api',
  name: 'Team API connection',
  provider: pluginPayload.provider,
  credential_type: CredentialTypeEnum.API_KEY,
  credentials: { api_key: 'sk********3456' },
  is_default: true,
  visibility: PermissionLevel.allTeamMembers,
  created_by: 'current-user',
  ...overrides,
})
const apiConnection = createCredential()
const oauthConnection = createCredential({
  id: 'personal-oauth',
  name: 'Personal OAuth connection',
  credential_type: CredentialTypeEnum.OAUTH2,
  credentials: {},
  is_default: false,
  visibility: PermissionLevel.onlyMe,
})

type ActionsHarnessProps = {
  connections: Credential[]
  providerName?: string
  onAction: () => void
  onUpdate: () => void
}

const ActionsHarness = ({ connections, ...props }: ActionsHarnessProps) => {
  const [handle] = useState(() => createDropdownMenuHandle<Credential>())
  return (
    <TooltipProvider delay={0} closeDelay={0}>
      {connections.map((credential) => (
        <ConnectionActionsTrigger key={credential.id} handle={handle} credential={credential} />
      ))}
      <ConnectionActions handle={handle} pluginPayload={pluginPayload} {...props} />
    </TooltipProvider>
  )
}

const renderActions = (
  props: Partial<ActionsHarnessProps> = {},
  workspacePermissionKeys = ['credential.use', 'credential.create', 'credential.manage'],
) => {
  const onAction = vi.fn()
  const onUpdate = vi.fn()
  const rendered = renderWithConsoleQuery(
    <ActionsHarness
      connections={[apiConnection, oauthConnection]}
      onAction={onAction}
      onUpdate={onUpdate}
      {...props}
    />,
    { accountProfile: { id: 'current-user' }, workspacePermissionKeys },
  )
  return { ...rendered, onAction, onUpdate }
}

const openMenu = async (user: ReturnType<typeof userEvent.setup>, credential = apiConnection) => {
  await user.click(
    screen.getByRole('button', {
      name: `common.operation.moreActionsFor:${JSON.stringify({ name: credential.name })}`,
    }),
  )
  return screen.findByRole('menu')
}

const openEditor = async (user: ReturnType<typeof userEvent.setup>, credential = apiConnection) => {
  const menu = await openMenu(user, credential)
  await user.click(within(menu).getByRole('menuitem', { name: 'plugin.auth.connection.edit' }))
  return screen.findByRole('dialog', { name: /^plugin\.auth\.connection\.save/ })
}

const openReplacement = async (user: ReturnType<typeof userEvent.setup>) => {
  const menu = await openMenu(user)
  await user.click(
    within(menu).getByRole('menuitem', {
      name: 'plugin.auth.connection.replaceApiKey',
    }),
  )
  return screen.findByRole('dialog', { name: 'plugin.auth.useApiAuth' })
}

const deletePath = [
  'workspaces',
  'current',
  'toolProvider',
  'builtin',
  'byProvider',
  'delete',
  'post',
]

describe('ConnectionActions', () => {
  beforeEach(() => {
    mocks.consoleCall.mockResolvedValue({ result: 'success' })
    mocks.addCredential.mockResolvedValue({})
    mocks.updateCredential.mockResolvedValue({})
  })

  it.each([
    {
      credential: apiConnection,
      actions: [
        'plugin.auth.connection.edit',
        'plugin.auth.connection.replaceApiKey',
        'common.operation.remove',
      ],
    },
    {
      credential: oauthConnection,
      actions: [
        'plugin.auth.connection.edit',
        'plugin.auth.connection.reauthorize',
        'common.operation.remove',
      ],
    },
  ])('shows the three actions for $credential.name in order', async ({ credential, actions }) => {
    const user = userEvent.setup()
    renderActions()

    const menu = await openMenu(user, credential)

    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(actions)
  })

  it('explains disabled OAuth reauthorization and never starts another authorization', async () => {
    const user = userEvent.setup()
    const { onAction } = renderActions()
    const menu = await openMenu(user, oauthConnection)
    const reauthorize = within(menu).getByRole('menuitem', {
      name: 'plugin.auth.connection.reauthorize',
    })

    expect(reauthorize).toHaveAttribute('aria-disabled', 'true')
    expect(reauthorize).toHaveAttribute(
      'aria-description',
      'plugin.auth.connection.reauthorizeUnavailable',
    )
    await user.hover(reauthorize)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'plugin.auth.connection.reauthorizeUnavailable',
    )
    await user.click(reauthorize)

    expect(onAction).not.toHaveBeenCalled()
    expect(mocks.consoleCall).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it.each([
    {
      reason: 'missing manage permission',
      credential: apiConnection,
      permissions: ['credential.use'],
    },
    {
      reason: 'borrowed connection',
      credential: createCredential({ from_other_member: true, created_by: 'another-user' }),
      permissions: ['credential.use', 'credential.manage'],
    },
    {
      reason: 'enterprise connection',
      credential: createCredential({ from_enterprise: true }),
      permissions: ['credential.use', 'credential.manage'],
    },
  ])('hides the management menu for $reason', ({ credential, permissions }) => {
    renderActions({ connections: [credential] }, permissions)

    expect(
      screen.queryByRole('button', {
        name: /common\.operation\.moreActionsFor/,
      }),
    ).not.toBeInTheDocument()
  })

  it('disables editing and replacement for an unusable connection while allowing removal', async () => {
    const user = userEvent.setup()
    const unavailable = createCredential({ not_allowed_to_use: true })
    const { onAction } = renderActions({ connections: [unavailable] })
    const menu = await openMenu(user, unavailable)
    const edit = within(menu).getByRole('menuitem', { name: 'plugin.auth.connection.edit' })
    const replace = within(menu).getByRole('menuitem', {
      name: 'plugin.auth.connection.replaceApiKey',
    })

    expect(edit).toHaveAttribute('aria-disabled', 'true')
    expect(replace).toHaveAttribute('aria-disabled', 'true')
    await user.click(edit)
    await user.click(replace)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onAction).not.toHaveBeenCalled()

    await user.click(within(menu).getByRole('menuitem', { name: 'common.operation.remove' }))

    expect(await screen.findByRole('alertdialog')).toHaveTextContent(unavailable.name)
    expect(onAction).toHaveBeenCalledOnce()
    expect(mocks.consoleCall).not.toHaveBeenCalled()
  })

  it.each([apiConnection, oauthConnection])(
    'opens the shared editor for $name with the current provider',
    async (credential) => {
      const user = userEvent.setup()
      const { onAction } = renderActions({ providerName: 'GitHub' })

      const dialog = await openEditor(user, credential)

      expect(dialog).toHaveAccessibleName(
        'plugin.auth.connection.saveWithProvider:{"provider":"GitHub"}',
      )
      expect(
        within(dialog).getByRole('textbox', {
          name: 'plugin.auth.connection.name',
        }),
      ).toHaveValue(credential.name)
      expect(onAction).toHaveBeenCalledOnce()
    },
  )

  it('discards a canceled name and default choice before reopening the same connection', async () => {
    const user = userEvent.setup()
    renderActions()
    const dialog = await openEditor(user)
    const name = within(dialog).getByRole('textbox', { name: 'plugin.auth.connection.name' })
    await user.clear(name)
    await user.type(name, 'Unsaved connection')
    await user.click(
      within(dialog).getByRole('checkbox', {
        name: 'plugin.auth.connection.setWorkspaceDefault',
      }),
    )
    await user.click(within(dialog).getByRole('combobox', { name: 'plugin.auth.whoCanUse' }))
    await user.click(
      await screen.findByRole('option', { name: 'datasetSettings.form.permissionsOnlyMe' }),
    )
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(dialog).not.toBeInTheDocument())

    const reopened = await openEditor(user)

    expect(
      within(reopened).getByRole('textbox', {
        name: 'plugin.auth.connection.name',
      }),
    ).toHaveValue(apiConnection.name)
    expect(
      within(reopened).getByRole('checkbox', {
        name: 'plugin.auth.connection.setWorkspaceDefault',
      }),
    ).not.toBeChecked()
    expect(
      within(reopened).getByRole('combobox', { name: 'plugin.auth.whoCanUse' }),
    ).toHaveTextContent('plugin.auth.connection.allWorkspaceMembers')
    expect(within(reopened).getByRole('button', { name: 'common.operation.save' })).toBeEnabled()
    expect(mocks.consoleCall).not.toHaveBeenCalled()
  })

  it('removes the selected connection only after confirmation and refreshes the list', async () => {
    const user = userEvent.setup()
    const { onUpdate } = renderActions()
    let menu = await openMenu(user, oauthConnection)
    await user.click(within(menu).getByRole('menuitem', { name: 'common.operation.remove' }))
    const canceled = await screen.findByRole('alertdialog')
    expect(canceled).toHaveTextContent(oauthConnection.name)
    await user.click(within(canceled).getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(canceled).not.toBeInTheDocument())
    expect(mocks.consoleCall).not.toHaveBeenCalled()
    expect(onUpdate).not.toHaveBeenCalled()

    menu = await openMenu(user, oauthConnection)
    await user.click(within(menu).getByRole('menuitem', { name: 'common.operation.remove' }))
    const confirmed = await screen.findByRole('alertdialog')
    await user.click(within(confirmed).getByRole('button', { name: 'common.operation.confirm' }))

    await waitFor(() =>
      expect(mocks.consoleCall).toHaveBeenCalledWith(
        deletePath,
        {
          params: { provider: pluginPayload.provider },
          body: { credential_id: oauthConnection.id },
        },
        expect.anything(),
      ),
    )
    expect(onUpdate).toHaveBeenCalledOnce()
    await waitFor(() => expect(confirmed).not.toBeInTheDocument())
  })

  it('returns from API key replacement without saving and resets the canceled form', async () => {
    const user = userEvent.setup()
    renderActions()
    const dialog = await openReplacement(user)
    const name = within(dialog).getByRole('textbox', { name: 'plugin.auth.authorizationName' })
    expect(name).toHaveValue(apiConnection.name)
    await user.clear(name)
    await user.type(name, 'Unsaved API connection')
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(dialog).not.toBeInTheDocument())

    const reopened = await openReplacement(user)

    expect(
      within(reopened).getByRole('textbox', {
        name: 'plugin.auth.authorizationName',
      }),
    ).toHaveValue(apiConnection.name)
    expect(mocks.updateCredential).not.toHaveBeenCalled()
    expect(mocks.addCredential).not.toHaveBeenCalled()
    expect(mocks.consoleCall).not.toHaveBeenCalled()
  })

  it('updates the existing API key connection and refreshes after replacement', async () => {
    const user = userEvent.setup()
    const { onUpdate } = renderActions()
    const dialog = await openReplacement(user)
    const secret = within(dialog).getByLabelText('API Key')
    await user.clear(secret)
    await user.type(secret, 'replacement-test-key')
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))

    await waitFor(() =>
      expect(mocks.updateCredential).toHaveBeenCalledWith({
        credentials: { api_key: 'replacement-test-key' },
        credential_id: apiConnection.id,
        name: apiConnection.name,
      }),
    )
    expect(mocks.addCredential).not.toHaveBeenCalled()
    expect(onUpdate).toHaveBeenCalledOnce()
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
  })

  it('coordinates removal from API key replacement through the confirmation dialog', async () => {
    const user = userEvent.setup()
    const { onUpdate } = renderActions()
    const replacement = await openReplacement(user)
    await user.click(within(replacement).getByRole('button', { name: 'common.operation.remove' }))

    const confirmation = await screen.findByRole('alertdialog')
    expect(confirmation).toHaveTextContent(apiConnection.name)
    await waitFor(() => expect(replacement).not.toBeInTheDocument())
    expect(mocks.consoleCall).not.toHaveBeenCalled()
    expect(mocks.updateCredential).not.toHaveBeenCalled()
    await user.click(within(confirmation).getByRole('button', { name: 'common.operation.confirm' }))

    await waitFor(() =>
      expect(mocks.consoleCall).toHaveBeenCalledWith(
        deletePath,
        { params: { provider: pluginPayload.provider }, body: { credential_id: apiConnection.id } },
        expect.anything(),
      ),
    )
    expect(onUpdate).toHaveBeenCalledOnce()
    await waitFor(() => expect(confirmation).not.toBeInTheDocument())
  })
})
