import type { FormSchema } from '@/app/components/base/form/types'
import { ORPCError } from '@orpc/client'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vite-plus/test'
import { FormTypeEnum } from '@/app/components/base/form/types'
import { toast } from '@/app/notifications'
import { createDeferred } from '@/test/deferred'
import ApiKeyDialog from '../api-key-dialog'
import { credentialSchemas, renderConnectionUi as render } from './credential-schema-fixture'

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
    render(
      <ApiKeyDialog
        mode="add"
        open
        credentialSchemas={credentialSchemas}
        onSave={onSave}
        onOpenChange={onOpenChange}
      />,
    )
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

  it('disables submission when a real credential schema has not been supplied', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<ApiKeyDialog mode="add" open onSave={onSave} onOpenChange={vi.fn()} />)
    const dialog = screen.getByRole('dialog', { name: 'share.connections.setup.addApiKey' })
    await user.type(
      within(dialog).getByRole('textbox', { name: 'plugin.auth.authorizationName' }),
      'Research',
    )
    expect(within(dialog).getByRole('button', { name: 'common.operation.save' })).toBeDisabled()
    expect(
      within(dialog).queryByLabelText(/share\.connections\.setup\.apiKey/),
    ).not.toBeInTheDocument()
    await user.keyboard('{Enter}')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('saves supplied credential fields without a hardcoded prefix rule', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const schemas: FormSchema[] = [
      {
        name: 'provider_token',
        label: 'Provider token',
        type: FormTypeEnum.secretInput,
        required: true,
      },
    ]
    render(
      <ApiKeyDialog
        mode="add"
        open
        credentialSchemas={schemas}
        onSave={onSave}
        onOpenChange={vi.fn()}
      />,
    )
    const dialog = screen.getByRole('dialog', { name: 'share.connections.setup.addApiKey' })
    const save = within(dialog).getByRole('button', { name: 'common.operation.save' })
    await user.type(
      within(dialog).getByRole('textbox', { name: 'plugin.auth.authorizationName' }),
      '  Research  ',
    )
    expect(save).toBeDisabled()
    await user.type(
      within(dialog).getByLabelText('Provider token', { selector: 'input' }),
      'provider-secret',
    )
    expect(save).toBeEnabled()
    await user.click(save)
    expect(onSave).toHaveBeenCalledExactlyOnceWith({
      name: 'Research',
      credentials: { provider_token: 'provider-secret' },
    })
  })

  it('preserves schema defaults and validates only conditionally visible credentials', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const schemas: FormSchema[] = [
      {
        name: 'region',
        label: 'Region',
        type: FormTypeEnum.textInput,
        required: true,
        default: 'eu',
      },
      {
        name: 'mode',
        label: 'Connection mode',
        type: FormTypeEnum.textInput,
        required: true,
        default: 'basic',
      },
      {
        name: 'secret',
        label: 'Custom token',
        type: FormTypeEnum.secretInput,
        required: true,
        show_on: [{ variable: 'mode', value: 'custom' }],
      },
    ]
    render(
      <ApiKeyDialog
        mode="add"
        open
        credentialSchemas={schemas}
        onSave={onSave}
        onOpenChange={vi.fn()}
      />,
    )
    const dialog = screen.getByRole('dialog', { name: 'share.connections.setup.addApiKey' })
    const save = within(dialog).getByRole('button', { name: 'common.operation.save' })
    await user.type(
      within(dialog).getByRole('textbox', { name: 'plugin.auth.authorizationName' }),
      'Custom connection',
    )
    expect(within(dialog).getByRole('textbox', { name: 'Region' })).toHaveValue('eu')
    expect(within(dialog).queryByLabelText('Custom token')).not.toBeInTheDocument()
    expect(save).toBeEnabled()
    const mode = within(dialog).getByRole('textbox', { name: 'Connection mode' })
    await user.clear(mode)
    await user.type(mode, 'custom')
    const secret = within(dialog).getByLabelText('Custom token', { selector: 'input' })
    expect(save).toBeDisabled()
    await user.type(secret, 'custom-secret')
    expect(save).toBeEnabled()
    await user.click(save)
    expect(onSave).toHaveBeenCalledExactlyOnceWith({
      name: 'Custom connection',
      credentials: { region: 'eu', mode: 'custom', secret: 'custom-secret' },
    })
  })

  it('distinguishes rejected credentials from a request failure without discarding the draft', async () => {
    const user = userEvent.setup()
    const onSave = vi
      .fn()
      .mockRejectedValueOnce(new ORPCError('connection_credentials_invalid', { status: 400 }))
      .mockRejectedValueOnce(new ORPCError('connection_credentials_unavailable', { status: 503 }))
      .mockResolvedValueOnce(undefined)
    const onOpenChange = vi.fn()
    render(
      <ApiKeyDialog
        mode="add"
        open
        credentialSchemas={credentialSchemas}
        onSave={onSave}
        onOpenChange={onOpenChange}
      />,
    )
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
        credentialSchemas={credentialSchemas}
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
