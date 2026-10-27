import { ORPCError } from '@orpc/client'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vite-plus/test'
import { toast } from '@/app/notifications'
import { createDeferred } from '@/test/deferred'
import ApiKeyDialog from '../api-key-dialog'

vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))

describe('ApiKeyDialog', () => {
  it.each([
    { reason: 'cancelled', error: new DOMException('Cancelled', 'AbortError') },
    {
      reason: 'stale scope',
      error: new ORPCError('CLIENT_ERROR', {
        cause: new DOMException('App changed', 'AbortError'),
      }),
    },
  ])('keeps the draft without a toast after a $reason request', async ({ error }) => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockRejectedValue(error)
    const onOpenChange = vi.fn()
    render(<ApiKeyDialog mode="add" open onSave={onSave} onOpenChange={onOpenChange} />)
    const dialog = screen.getByRole('dialog', { name: 'share.connections.setup.addApiKey' })
    await user.type(
      within(dialog).getByRole('textbox', { name: 'plugin.auth.authorizationName' }),
      'Research',
    )
    const credential = within(dialog).getByLabelText(/share\.connections\.setup\.apiKey/)
    await user.type(credential, 'provider-secret')
    const save = within(dialog).getByRole('button', { name: 'common.operation.save' })
    await user.click(save)
    await waitFor(() => expect(save).not.toHaveAttribute('aria-disabled', 'true'))
    expect(onSave).toHaveBeenCalledOnce()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
    expect(credential).toHaveValue('provider-secret')
  })

  it.each([
    { mode: 'add' as const, title: 'share.connections.setup.addApiKey', connectionName: '' },
    {
      mode: 'replace' as const,
      title: 'share.connections.apiKeys.replaceTitle',
      connectionName: 'Original key',
    },
  ])(
    'requires both fixed fields and accepts a non-sk secret for $mode without provider configuration',
    async ({ mode, title, connectionName }) => {
      const user = userEvent.setup()
      const onSave = vi.fn()
      const onOpenChange = vi.fn()
      render(
        <ApiKeyDialog
          mode={mode}
          connectionName={connectionName}
          open
          onSave={onSave}
          onOpenChange={onOpenChange}
        />,
      )
      const dialog = screen.getByRole('dialog', { name: title })
      const name = within(dialog).getByRole('textbox', { name: 'plugin.auth.authorizationName' })
      const token = within(dialog).getByLabelText(/share\.connections\.setup\.apiKey/)
      const save = within(dialog).getByRole('button', { name: 'common.operation.save' })
      expect(name).toHaveValue(connectionName)
      expect(token).toHaveValue('')
      expect(token).toHaveAttribute('type', 'password')
      expect(save).toBeDisabled()
      await user.clear(name)
      await user.type(name, '   ')
      await user.type(token, '   ')
      expect(save).toBeDisabled()
      await user.clear(name)
      await user.type(name, '  Research  ')
      expect(save).toBeDisabled()
      await user.clear(token)
      await user.type(token, '  provider-secret  ')
      expect(save).toBeEnabled()
      await user.click(save)

      expect(onSave).toHaveBeenCalledExactlyOnceWith({
        name: 'Research',
        credentials: { api_key: '  provider-secret  ' },
      })
      expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
    },
  )

  it('distinguishes rejected credentials from a request failure without discarding the draft', async () => {
    const user = userEvent.setup()
    const onSave = vi
      .fn()
      .mockRejectedValueOnce(new ORPCError('connection_credentials_invalid', { status: 400 }))
      .mockRejectedValueOnce(new ORPCError('connection_credentials_unavailable', { status: 503 }))
      .mockResolvedValueOnce(undefined)
    const onOpenChange = vi.fn()
    render(<ApiKeyDialog mode="add" open onSave={onSave} onOpenChange={onOpenChange} />)
    const dialog = screen.getByRole('dialog', { name: 'share.connections.setup.addApiKey' })
    const name = within(dialog).getByRole('textbox', { name: 'plugin.auth.authorizationName' })
    const token = within(dialog).getByLabelText(/share\.connections\.setup\.apiKey/)
    const save = within(dialog).getByRole('button', { name: 'common.operation.save' })
    await user.type(name, 'Research')
    await user.type(token, 'provider-secret')
    await user.click(save)
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'share.connections.apiKeys.validationError',
    )
    expect(token).toHaveValue('provider-secret')
    expect(toast.error).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
    await user.type(token, '-retry')
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
    await user.click(save)
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledExactlyOnceWith('common.api.actionFailed'),
    )
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
    expect(token).toHaveValue('provider-secret-retry')
    await user.click(save)
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
    expect(toast.error).toHaveBeenCalledOnce()
  })

  it('retains a replacement draft after failure and blocks duplicate submission and closing while saving', async () => {
    const user = userEvent.setup()
    const request = createDeferred()
    const onSave = vi.fn().mockReturnValueOnce(request.promise).mockResolvedValueOnce(undefined)
    const onOpenChange = vi.fn()
    render(
      <ApiKeyDialog
        mode="replace"
        open
        connectionName="Original key"
        onSave={onSave}
        onOpenChange={onOpenChange}
      />,
    )
    const dialog = screen.getByRole('dialog', { name: 'share.connections.apiKeys.replaceTitle' })
    const name = within(dialog).getByRole('textbox', { name: 'plugin.auth.authorizationName' })
    const apiKey = within(dialog).getByLabelText(/share\.connections\.setup\.apiKey/)
    const save = within(dialog).getByRole('button', { name: 'common.operation.save' })
    await user.clear(name)
    await user.type(name, '  Replacement key  ')
    await user.type(apiKey, '  provider-secret  ')
    await user.click(save)
    const values = { name: 'Replacement key', credentials: { api_key: '  provider-secret  ' } }
    expect(onSave).toHaveBeenCalledExactlyOnceWith(values)
    expect(save).toHaveAttribute('aria-disabled', 'true')
    expect(name).toBeDisabled()
    expect(apiKey).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'common.operation.cancel' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'common.operation.close' })).toBeDisabled()
    await user.click(save)
    await user.keyboard('{Escape}')
    expect(onSave).toHaveBeenCalledOnce()
    expect(onOpenChange).not.toHaveBeenCalled()
    await act(async () => {
      request.reject(new Error('Replacement failed'))
      await request.promise.catch(() => {})
    })
    expect(toast.error).toHaveBeenCalledExactlyOnceWith('common.api.actionFailed')
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
    expect(name).toHaveValue('  Replacement key  ')
    expect(apiKey).toHaveValue('  provider-secret  ')
    await user.click(save)
    expect(onSave).toHaveBeenNthCalledWith(2, values)
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
  })
})
