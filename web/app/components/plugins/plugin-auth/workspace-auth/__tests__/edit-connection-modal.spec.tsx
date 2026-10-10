import type { ComponentProps } from 'react'
import type { Credential } from '../../types'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { PermissionLevel } from '@/models/permission'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { AuthCategory, CredentialTypeEnum } from '../../types'
import EditConnectionModal from '../edit-connection-modal'

const mocks = vi.hoisted(() => ({
  consoleCall: vi.fn(),
  toastSuccess: vi.fn(),
}))

vi.mock('@/service/console/browser', () => ({
  consoleBrowserLink: {
    call: (...args: unknown[]) => mocks.consoleCall(...args),
  },
}))

vi.mock('@/app/notifications', () => ({
  toast: { success: mocks.toastSuccess, error: vi.fn() },
}))

type ModalProps = ComponentProps<typeof EditConnectionModal>

const pluginPayload = { category: AuthCategory.tool, provider: 'test-provider' }
const updatePath = [
  'workspaces',
  'current',
  'toolProvider',
  'builtin',
  'byProvider',
  'update',
  'post',
]
const defaultPath = [
  'workspaces',
  'current',
  'toolProvider',
  'builtin',
  'byProvider',
  'defaultCredential',
  'post',
]
const apiSecret = 'sk-test-raw-secret-123456'
const oauthSecret = 'oauth-raw-access-token'
const createCredential = (overrides: Partial<Credential> = {}): Credential => ({
  id: 'workspace-api',
  name: 'Team API connection',
  provider: pluginPayload.provider,
  credential_type: CredentialTypeEnum.API_KEY,
  credentials: { api_key: apiSecret },
  is_default: true,
  visibility: PermissionLevel.allTeamMembers,
  created_by: 'current-user',
  ...overrides,
})

const oauthCredential = createCredential({
  id: 'personal-oauth',
  name: 'Personal OAuth connection',
  credential_type: CredentialTypeEnum.OAUTH2,
  credentials: { access_token: oauthSecret },
  is_default: false,
  visibility: PermissionLevel.onlyMe,
})

const ControlledModal = (props: ModalProps) => {
  const [open, setOpen] = useState(props.open)
  return (
    <EditConnectionModal
      {...props}
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        props.onOpenChange(nextOpen)
      }}
    />
  )
}

const renderModal = (
  overrides: Partial<ModalProps> = {},
  workspacePermissionKeys = ['credential.use', 'credential.manage'],
) => {
  const props: ModalProps = {
    credential: createCredential(),
    pluginPayload,
    open: true,
    onOpenChange: vi.fn(),
    onCloseComplete: vi.fn(),
    onUpdate: vi.fn(),
    ...overrides,
  }
  const rendered = renderWithConsoleQuery(<ControlledModal {...props} />, {
    queryClient: createConsoleQueryClient(),
    workspacePermissionKeys,
  })
  return { ...rendered, props }
}

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('EditConnectionModal', () => {
  beforeEach(() => {
    mocks.consoleCall.mockResolvedValue({ result: 'success' })
  })

  it.each([
    {
      credential: createCredential(),
      scope: 'plugin.auth.connection.allWorkspaceMembers',
      changedScope: 'datasetSettings.form.permissionsOnlyMe',
    },
    {
      credential: oauthCredential,
      scope: 'datasetSettings.form.permissionsOnlyMe',
      changedScope: 'plugin.auth.connection.allWorkspaceMembers',
    },
  ])(
    'prefills $credential.name and saves a trimmed name without exposing credentials',
    async ({ credential, scope, changedScope }) => {
      const user = userEvent.setup()
      const { props } = renderModal({ credential })
      const dialog = screen.getByRole('dialog', { name: 'plugin.auth.connection.save' })
      const nameInput = within(dialog).getByRole('textbox', { name: 'plugin.auth.connection.name' })
      expect(nameInput).toHaveValue(credential.name)
      expect(nameInput).toBeRequired()
      const scopeInput = within(dialog).getByRole('combobox', { name: 'plugin.auth.whoCanUse' })
      expect(scopeInput).toHaveTextContent(scope)
      expect(dialog).not.toHaveTextContent(apiSecret)
      expect(dialog).not.toHaveTextContent(oauthSecret)

      await user.click(scopeInput)
      await user.click(await screen.findByRole('option', { name: changedScope }))
      expect(scopeInput).toHaveTextContent(changedScope)
      expect(mocks.consoleCall).not.toHaveBeenCalled()

      await user.clear(nameInput)
      await user.type(nameInput, '  Updated connection  ')
      await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))

      await waitFor(() => {
        expect(mocks.consoleCall).toHaveBeenCalledWith(
          updatePath,
          {
            params: { provider: pluginPayload.provider },
            body: { credential_id: credential.id, name: 'Updated connection' },
          },
          expect.anything(),
        )
        expect(props.onCloseComplete).toHaveBeenCalledOnce()
      })
      expect(mocks.consoleCall).toHaveBeenCalledOnce()
      expect(props.onOpenChange).toHaveBeenCalledWith(false)
      expect(props.onUpdate).toHaveBeenCalledOnce()
      expect(mocks.toastSuccess).toHaveBeenCalledWith('common.api.actionSuccess')
    },
  )

  it('names the form for the current provider', () => {
    renderModal({ providerName: 'GitHub' })

    expect(
      screen.getByRole('dialog', {
        name: 'plugin.auth.connection.saveWithProvider:{"provider":"GitHub"}',
      }),
    ).toBeVisible()
  })

  it('requires a nonblank connection name before saving', async () => {
    const user = userEvent.setup()
    const { props } = renderModal()
    const dialog = screen.getByRole('dialog', { name: 'plugin.auth.connection.save' })
    const nameInput = within(dialog).getByRole('textbox', { name: 'plugin.auth.connection.name' })
    const save = within(dialog).getByRole('button', { name: 'common.operation.save' })

    await user.clear(nameInput)
    expect(save).toBeDisabled()
    await user.type(nameInput, '   ')
    expect(save).toBeDisabled()
    await user.click(save)

    expect(mocks.consoleCall).not.toHaveBeenCalled()
    expect(props.onOpenChange).not.toHaveBeenCalledWith(false)
    expect(dialog).toBeVisible()
  })

  it.each([
    {
      credential: createCredential(),
      selectedScope: 'plugin.auth.connection.allWorkspaceMembers',
      otherScope: 'datasetSettings.form.permissionsOnlyMe',
    },
    {
      credential: oauthCredential,
      selectedScope: 'datasetSettings.form.permissionsOnlyMe',
      otherScope: 'plugin.auth.connection.allWorkspaceMembers',
    },
  ])(
    'lets $credential.name change the scope draft through the dropdown',
    async ({ credential, selectedScope, otherScope }) => {
      const user = userEvent.setup()
      const { props } = renderModal({ credential })
      const scope = screen.getByRole('combobox', { name: 'plugin.auth.whoCanUse' })

      await user.click(scope)

      const listbox = await screen.findByRole('listbox')
      const current = within(listbox).getByRole('option', { name: selectedScope })
      const other = within(listbox).getByRole('option', { name: otherScope })
      expect(current).toHaveAttribute('aria-selected', 'true')
      expect(other).not.toHaveAttribute('aria-disabled', 'true')
      await user.click(other)

      await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
      expect(scope).toHaveTextContent(otherScope)
      expect(mocks.consoleCall).not.toHaveBeenCalled()
      expect(props.onOpenChange).not.toHaveBeenCalledWith(false)
    },
  )

  it.each([createCredential(), oauthCredential])(
    'saves $name as the workspace default after updating its name',
    async (credential) => {
      const user = userEvent.setup()
      const { props } = renderModal({ credential })
      const dialog = screen.getByRole('dialog', { name: 'plugin.auth.connection.save' })
      const nameInput = within(dialog).getByRole('textbox', { name: 'plugin.auth.connection.name' })
      const scope = within(dialog).getByRole('combobox', { name: 'plugin.auth.whoCanUse' })
      await user.click(scope)
      await user.click(
        await screen.findByRole('option', { name: 'plugin.auth.connection.allWorkspaceMembers' }),
      )
      await user.clear(nameInput)
      await user.type(nameInput, 'Updated default connection')
      expect(
        within(dialog).getByRole('checkbox', {
          name: 'plugin.auth.connection.setWorkspaceDefault',
        }),
      ).not.toBeChecked()
      await user.click(
        within(dialog).getByRole('checkbox', {
          name: 'plugin.auth.connection.setWorkspaceDefault',
        }),
      )
      await user.click(
        within(dialog).getByRole('button', { name: 'plugin.auth.connection.saveAsDefault' }),
      )

      await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledWith(false))
      expect(
        mocks.consoleCall.mock.calls.map(([path, input]) => ({ path, body: input.body })),
      ).toEqual([
        {
          path: updatePath,
          body: { credential_id: credential.id, name: 'Updated default connection' },
        },
        { path: defaultPath, body: { id: credential.id } },
      ])
      expect(props.onUpdate).toHaveBeenCalledOnce()
    },
  )

  it('hides the default action for Only me and clears it when returning to workspace scope', async () => {
    const user = userEvent.setup()
    renderModal({ credential: oauthCredential })
    const scope = screen.getByRole('combobox', { name: 'plugin.auth.whoCanUse' })
    expect(
      screen.queryByRole('checkbox', { name: 'plugin.auth.connection.setWorkspaceDefault' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.operation.save' })).toBeEnabled()

    await user.click(scope)
    await user.click(
      await screen.findByRole('option', { name: 'plugin.auth.connection.allWorkspaceMembers' }),
    )
    await user.click(
      screen.getByRole('checkbox', { name: 'plugin.auth.connection.setWorkspaceDefault' }),
    )
    expect(
      screen.getByRole('button', { name: 'plugin.auth.connection.saveAsDefault' }),
    ).toBeEnabled()

    await user.click(scope)
    await user.click(
      await screen.findByRole('option', { name: 'datasetSettings.form.permissionsOnlyMe' }),
    )
    expect(
      screen.queryByRole('checkbox', { name: 'plugin.auth.connection.setWorkspaceDefault' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.operation.save' })).toBeEnabled()

    await user.click(scope)
    await user.click(
      await screen.findByRole('option', { name: 'plugin.auth.connection.allWorkspaceMembers' }),
    )

    expect(
      screen.getByRole('checkbox', { name: 'plugin.auth.connection.setWorkspaceDefault' }),
    ).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'common.operation.save' })).toBeEnabled()
    expect(mocks.consoleCall).not.toHaveBeenCalled()
  })

  it('does not set a workspace default after a checked connection is switched to Only me', async () => {
    const user = userEvent.setup()
    const { props } = renderModal()
    await user.click(
      screen.getByRole('checkbox', { name: 'plugin.auth.connection.setWorkspaceDefault' }),
    )
    expect(
      screen.getByRole('button', { name: 'plugin.auth.connection.saveAsDefault' }),
    ).toBeEnabled()
    await user.click(screen.getByRole('combobox', { name: 'plugin.auth.whoCanUse' }))
    await user.click(
      await screen.findByRole('option', { name: 'datasetSettings.form.permissionsOnlyMe' }),
    )

    expect(
      screen.queryByRole('checkbox', { name: 'plugin.auth.connection.setWorkspaceDefault' }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledWith(false))
    expect(mocks.consoleCall).toHaveBeenCalledOnce()
    expect(mocks.consoleCall).toHaveBeenCalledWith(
      updatePath,
      {
        params: { provider: pluginPayload.provider },
        body: { credential_id: 'workspace-api', name: 'Team API connection' },
      },
      expect.anything(),
    )
  })

  it('permits renaming without allowing a default change when credential use is unavailable', async () => {
    const user = userEvent.setup()
    const { props } = renderModal({}, ['credential.manage'])
    const checkbox = screen.getByRole('checkbox', {
      name: 'plugin.auth.connection.setWorkspaceDefault',
    })
    expect(checkbox).toHaveAttribute('aria-disabled', 'true')
    await user.click(checkbox)
    expect(checkbox).not.toBeChecked()
    const nameInput = screen.getByRole('textbox', { name: 'plugin.auth.connection.name' })
    await user.clear(nameInput)
    await user.type(nameInput, 'Updated connection')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledWith(false))
    expect(mocks.consoleCall).toHaveBeenCalledOnce()
    expect(mocks.consoleCall).toHaveBeenCalledWith(
      updatePath,
      {
        params: { provider: pluginPayload.provider },
        body: { credential_id: 'workspace-api', name: 'Updated connection' },
      },
      expect.anything(),
    )
  })

  it('prevents saving when credential management is unavailable', async () => {
    const user = userEvent.setup()
    renderModal({}, ['credential.use'])
    const save = screen.getByRole('button', { name: 'common.operation.save' })

    expect(save).toBeDisabled()
    await user.click(save)

    expect(mocks.consoleCall).not.toHaveBeenCalled()
  })

  it.each(['update', 'defaultCredential'])(
    'preserves the draft after %s fails and retries only the remaining work',
    async (failedOperation) => {
      const user = userEvent.setup()
      let failed = false
      mocks.consoleCall.mockImplementation(async (path: string[]) => {
        if (path.at(-2) === failedOperation && !failed) {
          failed = true
          throw new Error('Connection save failed')
        }
        return { result: 'success' }
      })
      const { props } = renderModal()
      const dialog = screen.getByRole('dialog', { name: 'plugin.auth.connection.save' })
      const nameInput = within(dialog).getByRole('textbox', { name: 'plugin.auth.connection.name' })
      const checkbox = within(dialog).getByRole('checkbox', {
        name: 'plugin.auth.connection.setWorkspaceDefault',
      })
      await user.clear(nameInput)
      await user.type(nameInput, 'Draft connection')
      await user.click(checkbox)
      const save = within(dialog).getByRole('button', {
        name: 'plugin.auth.connection.saveAsDefault',
      })
      await user.click(save)

      expect(await screen.findByRole('alert')).toHaveTextContent('common.api.actionFailed')
      expect(dialog).toBeVisible()
      expect(nameInput).toHaveValue('Draft connection')
      expect(checkbox).toBeChecked()
      expect(save).toBeEnabled()
      expect(props.onOpenChange).not.toHaveBeenCalledWith(false)
      expect(props.onUpdate).toHaveBeenCalledOnce()
      expect(mocks.toastSuccess).not.toHaveBeenCalled()
      if (failedOperation === 'update') {
        expect(
          mocks.consoleCall.mock.calls.some(([path]) => path.includes('defaultCredential')),
        ).toBe(false)
      }

      await user.click(save)

      await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledWith(false))
      expect(
        mocks.consoleCall.mock.calls.filter(([path]) => path.at(-2) === 'update'),
      ).toHaveLength(failedOperation === 'update' ? 2 : 1)
      expect(
        mocks.consoleCall.mock.calls.filter(([path]) => path.at(-2) === 'defaultCredential'),
      ).toHaveLength(failedOperation === 'defaultCredential' ? 2 : 1)
      expect(props.onUpdate).toHaveBeenCalledTimes(2)
      expect(mocks.toastSuccess).toHaveBeenCalledOnce()
    },
  )

  it('blocks duplicate submission, cancellation, and Escape during both save requests', async () => {
    const user = userEvent.setup()
    const update = createDeferred<{ result: string }>()
    const setDefault = createDeferred<{ result: string }>()
    mocks.consoleCall.mockImplementation((path: string[]) =>
      path.at(-2) === 'update' ? update.promise : setDefault.promise,
    )
    const { props } = renderModal()
    const dialog = screen.getByRole('dialog', { name: 'plugin.auth.connection.save' })
    const nameInput = within(dialog).getByRole('textbox', { name: 'plugin.auth.connection.name' })
    const scope = within(dialog).getByRole('combobox', { name: 'plugin.auth.whoCanUse' })
    const checkbox = within(dialog).getByRole('checkbox', {
      name: 'plugin.auth.connection.setWorkspaceDefault',
    })
    const cancel = within(dialog).getByRole('button', { name: 'common.operation.cancel' })
    await user.click(checkbox)
    const save = within(dialog).getByRole('button', {
      name: 'plugin.auth.connection.saveAsDefault',
    })
    await user.click(save)

    const assertPendingInteractions = async () => {
      expect(nameInput).toBeDisabled()
      expect(scope).toBeDisabled()
      expect(checkbox).toHaveAttribute('aria-disabled', 'true')
      expect(cancel).toBeDisabled()
      expect(save).toHaveAttribute('aria-disabled', 'true')
      await user.click(save)
      await user.keyboard('{Enter}')
      await user.click(cancel)
      await user.click(scope)
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
      await user.keyboard('{Escape}')
      expect(dialog).toBeVisible()
      expect(props.onOpenChange).not.toHaveBeenCalledWith(false)
      expect(props.onCloseComplete).not.toHaveBeenCalled()
      expect(props.onUpdate).not.toHaveBeenCalled()
      expect(mocks.toastSuccess).not.toHaveBeenCalled()
    }

    await waitFor(() =>
      expect(mocks.consoleCall).toHaveBeenCalledWith(
        updatePath,
        expect.anything(),
        expect.anything(),
      ),
    )
    await assertPendingInteractions()
    expect(mocks.consoleCall).toHaveBeenCalledOnce()

    await act(async () => update.resolve({ result: 'success' }))
    await waitFor(() =>
      expect(mocks.consoleCall).toHaveBeenCalledWith(
        defaultPath,
        expect.anything(),
        expect.anything(),
      ),
    )
    await assertPendingInteractions()
    expect(mocks.consoleCall).toHaveBeenCalledTimes(2)

    await act(async () => setDefault.resolve({ result: 'success' }))

    await waitFor(() => expect(props.onCloseComplete).toHaveBeenCalledOnce())
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
    expect(props.onUpdate).toHaveBeenCalledOnce()
    expect(mocks.toastSuccess).toHaveBeenCalledOnce()
  })
})
