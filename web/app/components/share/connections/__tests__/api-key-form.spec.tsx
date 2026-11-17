import type { ProviderConfig } from '@dify/contracts/api/web/types.gen'
import type { ApiKeyFormProps } from '../api-key-form'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { ORPCError } from '@orpc/client'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiKeyForm } from '../api-key-form'

vi.mock('@/hooks/use-i18n', () => ({
  useRenderI18nObject: () => (content: Record<string, string>) => content.en_US ?? '',
}))
vi.mock('@/service/use-triggers', () => ({
  useTriggerPluginDynamicOptions: () => ({ data: undefined, isLoading: false, error: null }),
}))
vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))

const secret: ProviderConfig = {
  name: 'token',
  label: { en_US: 'Access token' },
  type: 'secret-input',
  required: true,
}

function renderForm(props: Partial<ApiKeyFormProps> = {}) {
  const onSave = vi.fn()
  render(
    <Dialog open>
      <DialogContent>
        <ApiKeyForm mode="add" schemas={[secret]} onSave={onSave} onClose={vi.fn()} {...props} />
      </DialogContent>
    </Dialog>,
  )
  return { onSave }
}

it('submits schema credentials separately from the authorization name and preserves false and zero defaults', async () => {
  const user = userEvent.setup()
  const { onSave } = renderForm({
    schemas: [
      secret,
      { name: 'name', label: { en_US: 'Provider account' }, type: 'text-input', required: true },
      {
        name: 'enabled',
        label: { en_US: 'Enabled' },
        type: 'boolean',
        required: true,
        default: false,
      },
      { name: 'version', label: { en_US: 'Version' }, type: 'select', required: false, default: 0 },
    ],
  })
  await user.type(
    screen.getByRole('textbox', { name: 'plugin.auth.authorizationName' }),
    '  Research  ',
  )
  await user.type(screen.getByRole('textbox', { name: 'Provider account' }), 'my-account')
  const token = screen.getByLabelText('Access token')
  expect(token).toHaveAttribute('type', 'password')
  await user.type(token, '  provider-secret  ')
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  expect(onSave).toHaveBeenCalledExactlyOnceWith({
    name: 'Research',
    credentials: { token: '  provider-secret  ', name: 'my-account', enabled: false, version: 0 },
  })
})

it('keeps Save unavailable while any required schema text field contains only whitespace', async () => {
  const user = userEvent.setup()
  const { onSave } = renderForm({ connectionName: 'Research' })
  const token = screen.getByLabelText('Access token')
  await user.type(token, '   ')
  await user.tab()
  expect(token).toBeInvalid()
  expect(screen.getByRole('button', { name: 'common.operation.save' })).toBeDisabled()
  expect(onSave).not.toHaveBeenCalled()
  await user.type(token, 'secret')
  expect(token).not.toBeInvalid()
  expect(screen.getByRole('button', { name: 'common.operation.save' })).toBeEnabled()
})

it('blocks a rejected credential until a credential changes, including boolean values', async () => {
  const user = userEvent.setup()
  const onSave = vi
    .fn()
    .mockRejectedValueOnce(new ORPCError('connection_credentials_invalid', { status: 400 }))
    .mockResolvedValue(undefined)
  renderForm({
    connectionName: 'Research',
    onSave,
    schemas: [
      { ...secret, default: 'default-secret' },
      {
        name: 'enabled',
        label: { en_US: 'Enabled' },
        type: 'boolean',
        required: true,
        default: false,
      },
    ],
  })
  const save = screen.getByRole('button', { name: 'common.operation.save' })
  await user.click(save)
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'share.connections.apiKeys.validationError',
  )
  expect(save).toBeDisabled()
  await user.type(
    screen.getByRole('textbox', { name: 'plugin.auth.authorizationName' }),
    ' renamed',
  )
  expect(save).toBeDisabled()
  await user.click(screen.getByRole('radio', { name: 'True' }))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(save).toBeEnabled()
  await user.click(save)
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2))
  expect(onSave).toHaveBeenLastCalledWith({
    name: 'Research renamed',
    credentials: { token: 'default-secret', enabled: true },
  })
})
