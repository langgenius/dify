import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vite-plus/test'
import { createDeferred } from '@/test/deferred'
import ApiKeyDialog from '../api-key-dialog'

describe('ApiKeyDialog', () => {
  it('validates the trimmed case-sensitive key prefix while typing and prevents Enter from submitting an invalid key', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(
      <ApiKeyDialog
        mode="add"
        open
        onSave={onSave}
        onOpenChange={vi.fn()}
        onCloseComplete={vi.fn()}
      />,
    )
    const dialog = screen.getByRole('dialog', { name: 'share.connections.setup.addApiKey' })
    const name = within(dialog).getByRole('textbox', { name: 'plugin.auth.authorizationName' })
    const apiKey = within(dialog).getByLabelText(/share\.connections\.setup\.apiKey/)
    const save = within(dialog).getByRole('button', { name: 'common.operation.save' })
    expect(
      within(dialog).queryByText('share.connections.apiKeys.validationError'),
    ).not.toBeInTheDocument()
    await user.type(name, 'Search key')
    await user.type(apiKey, '   ')
    expect(save).toBeDisabled()
    expect(
      within(dialog).queryByText('share.connections.apiKeys.validationError'),
    ).not.toBeInTheDocument()

    await user.clear(apiKey)
    await user.type(apiKey, 'invalid-key')
    expect(within(dialog).getByText('share.connections.apiKeys.validationError')).toBeVisible()
    expect(apiKey).toHaveAttribute('aria-invalid', 'true')
    expect(apiKey).toHaveAccessibleDescription('share.connections.apiKeys.validationError')
    expect(save).toBeDisabled()

    await user.clear(apiKey)
    await user.type(apiKey, 'sk')
    expect(
      within(dialog).queryByText('share.connections.apiKeys.validationError'),
    ).not.toBeInTheDocument()
    expect(apiKey).not.toHaveAttribute('aria-invalid', 'true')
    expect(apiKey).not.toHaveAccessibleDescription(/share.connections.apiKeys.validationError/)
    expect(save).toBeEnabled()

    await user.clear(apiKey)
    await user.type(apiKey, 'Sk-key')
    expect(within(dialog).getByText('share.connections.apiKeys.validationError')).toBeVisible()
    expect(apiKey).toHaveAttribute('aria-invalid', 'true')
    expect(save).toBeDisabled()
    await user.keyboard('{Enter}')
    expect(onSave).not.toHaveBeenCalled()

    await user.clear(apiKey)
    await user.type(apiKey, '  sk-secret  ')
    expect(
      within(dialog).queryByText('share.connections.apiKeys.validationError'),
    ).not.toBeInTheDocument()
    expect(save).toBeEnabled()
    await user.click(save)
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ name: 'Search key', apiKey: 'sk-secret' })
  })

  it('retains the replacement draft for retry after an asynchronous save fails and prevents duplicate submissions', async () => {
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
        onCloseComplete={vi.fn()}
      />,
    )

    const dialog = screen.getByRole('dialog', { name: 'share.connections.apiKeys.replaceTitle' })
    const name = within(dialog).getByRole('textbox', { name: 'plugin.auth.authorizationName' })
    const apiKey = within(dialog).getByLabelText(/share\.connections\.setup\.apiKey/)
    const save = within(dialog).getByRole('button', { name: 'common.operation.save' })
    await user.clear(name)
    await user.type(name, '  Replacement key  ')
    await user.type(apiKey, '  sk-new-secret  ')
    await user.click(save)

    expect(onSave).toHaveBeenCalledExactlyOnceWith({
      name: 'Replacement key',
      apiKey: 'sk-new-secret',
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
    expect(apiKey).toHaveValue('  sk-new-secret  ')
    expect(save).toBeEnabled()
    await user.click(save)
    expect(onSave).toHaveBeenNthCalledWith(2, { name: 'Replacement key', apiKey: 'sk-new-secret' })
    expect(onSave).toHaveBeenCalledTimes(2)
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
  })
})
