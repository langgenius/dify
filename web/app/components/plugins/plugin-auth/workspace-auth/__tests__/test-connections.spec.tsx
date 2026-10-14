import type { TestConnection, TestConnectionDraft } from '../../app-user-auth/test-connection/model'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { PermissionLevel } from '@/models/permission'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { useMockTestConnectionSource } from '../../app-user-auth/test-connection/use-mock-test-connection-source'
import { CredentialTypeEnum } from '../../types'
import ConnectionSelector from '../connection-selector'

const mocks = vi.hoisted(() => ({
  consoleCall: vi.fn(),
  schemaHook: vi.fn(() => ({ data: [], isLoading: false })),
  addHook: vi.fn(() => ({ mutateAsync: vi.fn() })),
  updateHook: vi.fn(() => ({ mutateAsync: vi.fn() })),
}))
vi.mock('@/service/console/browser', () => ({
  consoleBrowserLink: { call: (...args: unknown[]) => mocks.consoleCall(...args) },
}))

vi.mock('../../hooks/use-credential', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/use-credential')>()),
  useGetPluginCredentialSchemaHook: mocks.schemaHook,
  useAddPluginCredentialHook: mocks.addHook,
  useUpdatePluginCredentialHook: mocks.updateHook,
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
const apiKeyLabel = 'plugin.auth.connection.apiKey'
const saveLabel = 'common.operation.save'
const cancelLabel = 'common.operation.cancel'

const setup = (
  initial: TestConnectionDraft = {
    connections: [oauthConnection, apiKeyConnection],
    selectedId: apiKeyConnection.id,
  },
) => {
  const onChange = vi.fn()
  const onOAuthClientSettings = vi.fn()
  const Harness = () => {
    const [value, setValue] = useState(initial)
    const source = useMockTestConnectionSource({
      value,
      onChange: (draft) => {
        onChange(draft)
        setValue(draft)
      },
      canOAuth: true,
      canApiKey: true,
      onOAuthClientSettings,
    })
    return (
      <section aria-label="Test connections">
        <ConnectionSelector dataSource={source} />
      </section>
    )
  }
  return {
    ...renderWithConsoleQuery(<Harness />, { workspacePermissionKeys: [] }),
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
  afterEach(() => {
    expect(
      mocks.consoleCall.mock.calls.filter(
        ([path]) =>
          Array.isArray(path) && (path.includes('toolProvider') || path.includes('oauth')),
      ),
    ).toEqual([])
    expect(mocks.schemaHook).not.toHaveBeenCalled()
    expect(mocks.addHook).not.toHaveBeenCalled()
    expect(mocks.updateHook).not.toHaveBeenCalled()
  })

  it('discards a canceled API key draft, then saves only its name and masked key locally', async () => {
    const user = userEvent.setup()
    const { onChange } = setup()
    const openNewApiKey = async () => {
      await user.click(picker())
      await user.click(
        await screen.findByRole('button', { name: 'plugin.auth.connection.addApiKey' }),
      )
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
    expect(screen.getByRole('button', { name: 'plugin.auth.connection.addApiKey' })).toBeVisible()
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
