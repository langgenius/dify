import type { Credential } from '../../types'
import type { EditConnectionDataSource } from '../edit-connection-modal'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { PermissionLevel } from '@/models/permission'
import { createDeferred } from '@/test/deferred'
import { CredentialTypeEnum } from '../../types'
import EditConnectionModal from '../edit-connection-modal'

const credential: Credential = {
  id: 'gmail-connection',
  provider: 'langgenius/gmail/gmail',
  name: 'Workspace Gmail',
  credential_type: CredentialTypeEnum.OAUTH2,
  is_default: false,
  visibility: PermissionLevel.allTeamMembers,
}

const renderModal = (
  save: EditConnectionDataSource['save'] = vi.fn().mockResolvedValue(undefined),
  connection = credential,
) => {
  const onOpenChange = vi.fn()
  const Example = () => {
    const [open, setOpen] = useState(true)
    return (
      <>
        <button onClick={() => setOpen(true)}>Open edit dialog</button>
        <EditConnectionModal
          providerName="Gmail"
          credential={connection}
          dataSource={{ canEdit: true, canUse: true, save }}
          onCloseComplete={() => {}}
          open={open}
          onOpenChange={(nextOpen) => {
            setOpen(nextOpen)
            onOpenChange(nextOpen)
          }}
        />
      </>
    )
  }
  render(<Example />)
  return { save, onOpenChange }
}

const nameInput = () => screen.getByRole('textbox', { name: 'plugin.auth.connection.name' })
const saveButton = () => screen.getByRole('button', { name: 'common.operation.save' })
describe('EditConnectionModal', () => {
  it('saves trimmed metadata with an initially unchecked workspace-default option', async () => {
    const user = userEvent.setup()
    const { save } = renderModal()
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    await user.clear(nameInput())
    await user.type(nameInput(), '  Personal Gmail  ')
    await user.click(saveButton())
    expect(save).toHaveBeenCalledExactlyOnceWith({
      credential,
      name: 'Personal Gmail',
      setDefault: false,
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('shows a required-name error for whitespace and prevents saving', async () => {
    const user = userEvent.setup()
    const { save } = renderModal()
    await user.clear(nameInput())
    await user.type(nameInput(), '   ')
    await user.tab()
    expect(nameInput()).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText(/^common\.errorMsg\.fieldRequired/)).toBeVisible()
    expect(nameInput()).toHaveAccessibleDescription(/^common\.errorMsg\.fieldRequired/)
    expect(saveButton()).toBeDisabled()
    expect(save).not.toHaveBeenCalled()
  })

  it('shows the saved private scope and offers no workspace-default option', async () => {
    const user = userEvent.setup()
    const privateConnection = { ...credential, visibility: PermissionLevel.onlyMe }
    const { save } = renderModal(undefined, privateConnection)
    expect(screen.getByText('datasetSettings.form.permissionsOnlyMe')).toBeVisible()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    await user.click(saveButton())
    expect(save).toHaveBeenCalledExactlyOnceWith({
      credential: privateConnection,
      name: 'Workspace Gmail',
      setDefault: false,
    })
  })

  it('keeps the draft after failure and retries the same save', async () => {
    const user = userEvent.setup()
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error('Save failed'))
      .mockResolvedValueOnce(undefined)
    renderModal(save)
    await user.clear(nameInput())
    await user.type(nameInput(), 'Retry Gmail')
    await user.click(screen.getByRole('checkbox'))
    const submit = screen.getByRole('button', { name: 'plugin.auth.connection.saveAsDefault' })
    await user.click(submit)
    expect(await screen.findByRole('alert')).toHaveTextContent('common.api.actionFailed')
    expect(nameInput()).toHaveValue('Retry Gmail')
    expect(screen.getByRole('checkbox')).toBeChecked()
    await user.click(submit)
    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenLastCalledWith({
      credential,
      name: 'Retry Gmail',
      setDefault: true,
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('blocks duplicate submission and dismissal while saving', async () => {
    const user = userEvent.setup()
    const request = createDeferred<void>()
    const save = vi.fn(() => request.promise)
    const { onOpenChange } = renderModal(save)
    await user.click(saveButton())
    await user.click(saveButton())
    expect(save).toHaveBeenCalledOnce()
    expect(nameInput()).toBeDisabled()
    expect(screen.getByRole('button', { name: 'common.operation.cancel' })).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeVisible()
    await act(async () => {
      request.resolve()
      await request.promise
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('cancels without saving and starts a new draft when reopened', async () => {
    const user = userEvent.setup()
    const { save } = renderModal()
    await user.clear(nameInput())
    await user.type(nameInput(), 'Discard me')
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(save).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Open edit dialog' }))
    expect(await screen.findByRole('textbox', { name: 'plugin.auth.connection.name' })).toHaveValue(
      'Workspace Gmail',
    )
    expect(within(screen.getByRole('dialog')).getByRole('checkbox')).not.toBeChecked()
  })
})
