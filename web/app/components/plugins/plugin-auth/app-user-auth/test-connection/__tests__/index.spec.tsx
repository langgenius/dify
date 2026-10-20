import type { TestConnection, TestConnectionDraft } from '../model'
import type { ConsoleClient } from '@/service/console'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { FormTypeEnum } from '@/app/components/base/form/types'
import { PermissionLevel } from '@/models/permission'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import ConnectionSelector from '../../../connections/connection-selector'
import { AuthCategory, CredentialTypeEnum } from '../../../types'
import { useMockTestConnectionSource } from '../use-mock-test-connection-source'

const mocks = vi.hoisted(() => ({
  consoleCall: vi.fn(),
}))
vi.mock('@/service/console/browser', () => ({
  consoleBrowserLink: { call: (...args: unknown[]) => mocks.consoleCall(...args) },
}))

const oauthConnection: TestConnection = {
  id: 'test-oauth',
  name: 'Test OAuth connection',
  method: CredentialTypeEnum.OAUTH2,
  subtitle: '@test-user',
  visibility: PermissionLevel.onlyMe,
}
const apiKeyConnection: TestConnection = {
  id: 'test-api-key',
  name: 'Test API key',
  method: CredentialTypeEnum.API_KEY,
  subtitle: '•••• 1234',
  visibility: PermissionLevel.onlyMe,
}
const connectionNameLabel = 'plugin.auth.connection.name'
const apiKeyLabel = 'API Key'
const saveLabel = 'common.operation.save'
const cancelLabel = 'common.operation.cancel'
const pluginPayload = { category: AuthCategory.tool, provider: 'test-provider' }
type CredentialSchemas = Awaited<
  ReturnType<
    ConsoleClient['workspaces']['current']['toolProvider']['builtin']['byProvider']['credential']['schema']['byCredentialType']['get']
  >
>
const defaultSchema: CredentialSchemas = [
  {
    name: 'api_key',
    label: { en_US: apiKeyLabel },
    type: FormTypeEnum.secretInput,
    required: true,
    multiple: false,
  },
]

const setup = (
  initial: TestConnectionDraft = {
    connections: [oauthConnection, apiKeyConnection],
    selectedId: apiKeyConnection.id,
  },
  schemas: CredentialSchemas | null = defaultSchema,
) => {
  const queryClient = createConsoleQueryClient()
  if (schemas) {
    queryClient.setQueryData(
      consoleQuery.workspaces.current.toolProvider.builtin.byProvider.credential.schema.byCredentialType.get.queryKey(
        {
          input: {
            params: {
              provider: pluginPayload.provider,
              credential_type: CredentialTypeEnum.API_KEY,
            },
          },
        },
      ),
      schemas,
    )
  }
  const onChange = vi.fn()
  const onOAuthClientSettings = vi.fn()
  const Harness = () => {
    const [value, setValue] = useState(initial)
    const source = useMockTestConnectionSource({
      pluginPayload,
      value,
      onChange: (draft) => {
        onChange(draft)
        setValue(draft)
      },
      oauthEnabled: true,
      apiKeyEnabled: true,
      onOAuthClientSettings,
    })
    return (
      <section aria-label="Test connections">
        <ConnectionSelector dataSource={source} />
      </section>
    )
  }
  return {
    ...renderWithConsoleQuery(<Harness />, { queryClient, workspacePermissionKeys: [] }),
    onChange,
    onOAuthClientSettings,
  }
}

const picker = () =>
  within(screen.getByRole('region', { name: 'Test connections' })).getByRole('button')
const waitForPickerClosed = () =>
  waitFor(() => {
    expect(
      screen.queryByRole('dialog', { name: 'plugin.auth.authorization' }),
    ).not.toBeInTheDocument()
  })
const openAction = async (
  user: ReturnType<typeof userEvent.setup>,
  name: string,
  action: string,
) => {
  await user.click(picker())
  await user.click(
    await screen.findByRole('button', {
      name: `common.operation.moreActionsFor:${JSON.stringify({ name })}`,
    }),
  )
  await user.click(await screen.findByRole('menuitem', { name: action }))
}
const findConnectionDialog = () =>
  screen.findByRole('dialog', { name: 'plugin.auth.connection.save' })

describe('App user mock test connections', () => {
  beforeEach(() => {
    mocks.consoleCall.mockReset()
  })

  afterEach(() => {
    expect(
      mocks.consoleCall.mock.calls.filter(
        ([path]) =>
          Array.isArray(path) &&
          (path.includes('toolProvider') || path.includes('oauth')) &&
          path.slice(-4).join('.') !== 'credential.schema.byCredentialType.get',
      ),
    ).toEqual([])
  })

  it('discards a canceled API key draft, then saves only its name and masked key locally', async () => {
    const user = userEvent.setup()
    const { onChange } = setup()
    const openNewApiKey = async () => {
      await user.click(picker())
      await user.click(await screen.findByRole('button', { name: 'plugin.auth.common.addApiKey' }))
      return screen.findByRole('dialog', { name: 'plugin.auth.useApiAuth' })
    }
    const canceled = await openNewApiKey()
    const canceledName = within(canceled).getByRole('textbox', {
      name: 'plugin.auth.authorizationName',
    })
    await user.clear(canceledName)
    await user.type(canceledName, 'Discarded key')
    await user.type(
      within(canceled).getByLabelText(apiKeyLabel, { exact: false }),
      'discarded-secret',
    )
    await user.click(within(canceled).getByRole('button', { name: cancelLabel }))
    await waitFor(() => expect(canceled).not.toBeInTheDocument())
    expect(onChange).not.toHaveBeenCalled()
    expect(picker()).toHaveTextContent(apiKeyConnection.name)

    const dialog = await openNewApiKey()
    const name = within(dialog).getByRole('textbox', { name: 'plugin.auth.authorizationName' })
    const apiKey = within(dialog).getByLabelText(apiKeyLabel, { exact: false })
    expect(name).not.toHaveValue('Discarded key')
    expect(apiKey).toHaveValue('')
    expect(name).not.toBeRequired()
    expect(apiKey).toBeRequired()
    await user.clear(name)
    await user.click(within(dialog).getByRole('button', { name: saveLabel }))
    expect(apiKey).toHaveAttribute('aria-invalid', 'true')
    expect(onChange).not.toHaveBeenCalled()

    const secret = 'private-test-secret-7A2F'
    await user.type(name, '  New test key  ')
    await user.type(apiKey, secret)
    await user.click(
      within(dialog).getByRole('button', { name: /datasetSettings.form.permissionsAllMember/ }),
    )
    await user.click(
      await screen.findByRole('menuitemradio', { name: /datasetSettings.form.permissionsOnlyMe/ }),
    )
    await user.click(within(dialog).getByRole('button', { name: saveLabel }))
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    expect(picker()).toHaveTextContent('New test key')
    expect(picker()).toHaveTextContent('•••• 7A2F')
    expect(screen.queryByText(secret)).not.toBeInTheDocument()
    expect(JSON.stringify(onChange.mock.lastCall?.[0])).not.toContain(secret)
    await user.click(picker())
    const group = await screen.findByRole('group', {
      name: 'datasetSettings.form.permissionsOnlyMe',
    })
    const row = within(group).getByRole('button', { name: /^New test key/ })
    expect(row).toHaveAttribute('aria-pressed', 'true')
    expect(row).toHaveTextContent('•••• 7A2F')
  })

  it('uses the provider secret field and validates its required non-secret fields before saving a local connection', async () => {
    const user = userEvent.setup()
    const { onChange } = setup(undefined, [
      {
        name: 'api_token',
        label: { en_US: 'API token' },
        type: FormTypeEnum.secretInput,
        required: true,
        multiple: false,
      },
      {
        name: 'workspace_id',
        label: { en_US: 'Workspace ID' },
        type: FormTypeEnum.textInput,
        required: true,
        multiple: false,
      },
    ])
    await user.click(picker())
    await user.click(await screen.findByRole('button', { name: 'plugin.auth.common.addApiKey' }))
    const dialog = await screen.findByRole('dialog', { name: 'plugin.auth.useApiAuth' })
    const token = within(dialog).getByLabelText('API token', { exact: false })
    const workspaceId = within(dialog).getByRole('textbox', { name: /Workspace ID/ })
    expect(within(dialog).queryByLabelText(apiKeyLabel, { exact: false })).not.toBeInTheDocument()
    expect(token).toBeRequired()
    expect(workspaceId).toBeRequired()
    const secret = 'provider-api-token-8C4D'
    await user.type(token, secret)
    await user.click(within(dialog).getByRole('button', { name: saveLabel }))
    expect(workspaceId).toHaveAttribute('aria-invalid', 'true')
    expect(onChange).not.toHaveBeenCalled()

    await user.type(workspaceId, 'provider-workspace')
    await user.click(within(dialog).getByRole('button', { name: saveLabel }))
    await waitFor(() => expect(dialog).not.toBeInTheDocument())

    expect(picker()).toHaveTextContent('•••• 8C4D')
    expect(JSON.stringify(onChange.mock.calls)).not.toContain(secret)
    expect(document.body).not.toHaveTextContent(secret)
    expect(onChange).toHaveBeenCalledOnce()
  })

  it('keeps saving disabled while the provider schema loads and enables the provider form when it arrives', async () => {
    const user = userEvent.setup()
    let resolveSchema!: (schemas: CredentialSchemas) => void
    const schemaRequest = new Promise<CredentialSchemas>((resolve) => {
      resolveSchema = resolve
    })
    mocks.consoleCall.mockReturnValue(schemaRequest)
    const { onChange } = setup(undefined, null)
    await user.click(picker())
    await user.click(await screen.findByRole('button', { name: 'plugin.auth.common.addApiKey' }))
    const dialog = await screen.findByRole('dialog', { name: 'plugin.auth.useApiAuth' })
    const save = within(dialog).getByRole('button', { name: saveLabel })
    expect(save).toBeDisabled()
    expect(within(dialog).queryByLabelText(apiKeyLabel, { exact: false })).not.toBeInTheDocument()
    await user.click(save)
    expect(onChange).not.toHaveBeenCalled()

    await act(async () => {
      resolveSchema(defaultSchema)
      await schemaRequest
    })
    const apiKey = await within(dialog).findByLabelText(apiKeyLabel, { exact: false })
    expect(save).toBeEnabled()
    await user.type(apiKey, 'loaded-provider-key-5E6F')
    await user.click(save)
    await waitFor(() => expect(dialog).not.toBeInTheDocument())

    expect(picker()).toHaveTextContent('•••• 5E6F')
    expect(onChange).toHaveBeenCalledOnce()
  })

  it.each([apiKeyConnection, oauthConnection])(
    'renames a $method connection without replacing its secret or account',
    async (connection) => {
      const user = userEvent.setup()
      const { onChange } = setup({ connections: [connection], selectedId: connection.id })
      await openAction(user, connection.name, 'plugin.auth.connection.edit')
      const dialog = await findConnectionDialog()
      await waitForPickerClosed()
      const name = within(dialog).getByRole('textbox', { name: connectionNameLabel })
      expect(name).toHaveValue(connection.name)
      expect(within(dialog).queryByLabelText(apiKeyLabel)).not.toBeInTheDocument()
      await user.clear(name)
      await user.type(name, '  Renamed connection  ')
      const scope = within(dialog).getByRole('combobox', { name: 'plugin.auth.whoCanUse' })
      expect(scope).toHaveTextContent('datasetSettings.form.permissionsOnlyMe')
      await user.click(scope)
      await user.click(
        await screen.findByRole('option', { name: 'plugin.auth.connection.allWorkspaceMembers' }),
      )
      await user.click(within(dialog).getByRole('button', { name: saveLabel }))
      await waitFor(() => expect(dialog).not.toBeInTheDocument())

      expect(picker()).toHaveTextContent('Renamed connection')
      expect(picker()).toHaveTextContent(connection.subtitle)
      expect(onChange).toHaveBeenLastCalledWith({
        connections: [
          {
            ...connection,
            name: 'Renamed connection',
            visibility: PermissionLevel.allTeamMembers,
            isDefault: false,
          },
        ],
        selectedId: connection.id,
      })
      await openAction(user, 'Renamed connection', 'plugin.auth.connection.edit')
      const reopened = await findConnectionDialog()
      expect(
        within(reopened).getByRole('combobox', { name: 'plugin.auth.whoCanUse' }),
      ).toHaveTextContent('plugin.auth.connection.allWorkspaceMembers')
    },
  )

  it('requires a new API key when replacing one and retains only its masked tail', async () => {
    const user = userEvent.setup()
    const { onChange } = setup()
    await openAction(user, apiKeyConnection.name, 'plugin.auth.connection.replaceApiKey')
    const dialog = await screen.findByRole('dialog', { name: 'plugin.auth.useApiAuth' })
    const apiKey = within(dialog).getByLabelText(apiKeyLabel, { exact: false })
    expect(apiKey).toHaveValue('')
    await user.click(within(dialog).getByRole('button', { name: saveLabel }))
    expect(apiKey).toHaveAttribute('aria-invalid', 'true')
    expect(onChange).not.toHaveBeenCalled()
    const secret = 'replacement-secret-9B3C'
    await user.type(apiKey, secret)
    await user.click(within(dialog).getByRole('button', { name: saveLabel }))
    await waitFor(() => expect(dialog).not.toBeInTheDocument())

    expect(picker()).toHaveTextContent(apiKeyConnection.name)
    expect(picker()).toHaveTextContent('•••• 9B3C')
    expect(screen.queryByText(secret)).not.toBeInTheDocument()
    expect(JSON.stringify(onChange.mock.lastCall?.[0])).not.toContain(secret)
  })

  it('requires removal confirmation, falls back to the first connection and keeps the list empty after the last removal', async () => {
    const user = userEvent.setup()
    const { onChange } = setup()
    await openAction(user, apiKeyConnection.name, 'common.operation.remove')
    const canceled = await screen.findByRole('alertdialog')
    await user.click(within(canceled).getByRole('button', { name: cancelLabel }))
    await waitFor(() => expect(canceled).not.toBeInTheDocument())
    expect(onChange).not.toHaveBeenCalled()
    expect(picker()).toHaveTextContent(apiKeyConnection.name)

    for (const connection of [apiKeyConnection, oauthConnection]) {
      await openAction(user, connection.name, 'common.operation.remove')
      const dialog = await screen.findByRole('alertdialog')
      await user.click(within(dialog).getByRole('button', { name: 'common.operation.confirm' }))
      await waitFor(() => expect(dialog).not.toBeInTheDocument())
      if (connection === apiKeyConnection) {
        expect(picker()).toHaveTextContent(oauthConnection.name)
        expect(onChange).toHaveBeenLastCalledWith({
          connections: [oauthConnection],
          selectedId: oauthConnection.id,
        })
      }
    }
    expect(onChange).toHaveBeenLastCalledWith({ connections: [], selectedId: undefined })
    expect(screen.queryByRole('button', { name: /^Test OAuth connection/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Test API key/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'plugin.auth.addOAuth' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'plugin.auth.common.addApiKey' })).toBeVisible()
    expect(
      screen.queryByRole('group', { name: 'datasetSettings.form.permissionsOnlyMe' }),
    ).not.toBeInTheDocument()
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('adds and selects an OAuth mock connection without starting authorization', async () => {
    const user = userEvent.setup()
    const { onChange } = setup({ connections: [], selectedId: undefined })
    await user.click(await screen.findByRole('button', { name: 'plugin.auth.addOAuth' }))
    await waitForPickerClosed()

    expect(picker()).toHaveTextContent('OAuth test connection')
    expect(picker()).toHaveTextContent('@test-user')
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      connections: [
        expect.objectContaining({
          method: CredentialTypeEnum.OAUTH2,
          subtitle: '@test-user',
        }),
      ],
      selectedId: expect.any(String),
    })
  })

  it('delegates OAuth client settings to the App user client owner after closing the picker', async () => {
    const user = userEvent.setup()
    const { onChange, onOAuthClientSettings } = setup()
    await user.click(picker())
    await user.click(
      await screen.findByRole('button', { name: 'plugin.auth.connection.oauthClientSettings' }),
    )
    await waitForPickerClosed()

    expect(onOAuthClientSettings).toHaveBeenCalledOnce()
    expect(onChange).not.toHaveBeenCalled()
  })
})
