import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vite-plus/test'
import { createDeferred } from '@/test/deferred'
import ReplaceApiKeyDialog from '../replace-api-key-dialog'

describe('ReplaceApiKeyDialog', () => {
  it('retains the replacement draft for retry after an asynchronous save fails and prevents duplicate submissions', async () => {
    const user = userEvent.setup()
    const request = createDeferred()
    const onSave = vi.fn().mockReturnValueOnce(request.promise).mockResolvedValueOnce(undefined)
    const onOpenChange = vi.fn()
    render(
      <ReplaceApiKeyDialog
        open
        connectionName="Original key"
        onSave={onSave}
        onOpenChange={onOpenChange}
        onCloseComplete={vi.fn()}
      />,
    )

    const dialog = screen.getByRole('dialog', { name: 'share.connections.apiKeys.replaceTitle' })
    const name = within(dialog).getByRole('textbox', { name: 'plugin.auth.authorizationName' })
    const apiKey = within(dialog).getByLabelText(/share\.connections\.setup\.apiKey/)
    const save = within(dialog).getByRole('button', { name: 'common.operation.save' })
    await user.clear(name)
    await user.type(name, '  Replacement key  ')
    await user.type(apiKey, '  new-secret  ')
    await user.click(save)

    expect(onSave).toHaveBeenCalledExactlyOnceWith({
      name: 'Replacement key',
      apiKey: 'new-secret',
    })
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

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('common.api.actionFailed')
    expect(name).toHaveValue('  Replacement key  ')
    expect(apiKey).toHaveValue('  new-secret  ')
    expect(save).toBeEnabled()
    await user.click(save)
    expect(onSave).toHaveBeenNthCalledWith(2, { name: 'Replacement key', apiKey: 'new-secret' })
    expect(onSave).toHaveBeenCalledTimes(2)
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
  })
})
