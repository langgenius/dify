import type { FormSchema } from '@/app/components/base/form/types'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { FormTypeEnum } from '@/app/components/base/form/types'
import { renderWithAccountProfile as render } from '@/test/console/account-profile'
import { createDeferred } from '@/test/deferred'
import { AuthCategory } from '../../types'
import ApiKeyModal from '../api-key-modal'

const commands = vi.hoisted(() => ({ add: vi.fn(), update: vi.fn() }))
const schemas: FormSchema[] = [
  { name: 'api_key', label: 'API Key', type: FormTypeEnum.secretInput, required: true },
]
// Credential routing has separate hook tests; this suite owns form validation and submitted values.
vi.mock('../../hooks/use-credential', () => ({
  useAddPluginCredentialHook: () => ({ mutateAsync: commands.add }),
  useUpdatePluginCredentialHook: () => ({ mutateAsync: commands.update }),
  useGetPluginCredentialSchemaHook: () => ({ data: schemas, isLoading: false }),
}))
const payload = { category: AuthCategory.tool, provider: 'test-provider' }
beforeEach(() => {
  commands.add.mockResolvedValue({})
  commands.update.mockResolvedValue({})
})

it('validates the API key and submits the entered name, secret and selected visibility', async () => {
  const user = userEvent.setup()
  const onClose = vi.fn()
  const onCreated = vi.fn()
  render(<ApiKeyModal pluginPayload={payload} onClose={onClose} onCreated={onCreated} />)
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  expect(commands.add).not.toHaveBeenCalled()
  await user.type(screen.getByLabelText(/API Key/), 'sk-123')
  await user.type(screen.getByRole('textbox', { name: 'plugin.auth.authorizationName' }), 'My Key')
  await user.click(screen.getByRole('button', { name: /permissionsAllMember/ }))
  await user.click(
    within(screen.getByRole('menu', { name: /auth.whoCanUse/ })).getByRole('menuitemradio', {
      name: /permissionsOnlyMe/,
    }),
  )
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  expect(commands.add).toHaveBeenCalledExactlyOnceWith({
    credentials: { api_key: 'sk-123' },
    name: 'My Key',
    type: 'api-key',
    visibility: 'only_me',
  })
  expect(onCreated).not.toHaveBeenCalled()
})

it('uses the existing credential identity and preserves an unchanged secret on edit', async () => {
  const user = userEvent.setup()
  render(
    <ApiKeyModal
      pluginPayload={payload}
      editValues={{ api_key: '[__HIDDEN__]', __credential_id__: 'cred-1', __name__: 'Existing' }}
    />,
  )
  const name = screen.getByRole('textbox', { name: 'plugin.auth.authorizationName' })
  expect(name).toHaveValue('Existing')
  await user.clear(name)
  await user.type(name, 'Renamed')
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  await waitFor(() =>
    expect(commands.update).toHaveBeenCalledExactlyOnceWith({
      credentials: { api_key: '[__HIDDEN__]' },
      credential_id: 'cred-1',
      name: 'Renamed',
    }),
  )
  expect(commands.add).not.toHaveBeenCalled()
})

it('prevents duplicate submission and dismissal while creation is pending, then reports its identity', async () => {
  const user = userEvent.setup()
  const request = createDeferred<{ credentialId: string }>()
  const saveCommand = vi.fn(() => request.promise)
  const onClose = vi.fn()
  const onOpenChange = vi.fn()
  const onCreated = vi.fn()
  render(
    <ApiKeyModal
      dataSource={{ schemas, save: saveCommand }}
      onClose={onClose}
      onOpenChange={onOpenChange}
      onCreated={onCreated}
    />,
  )
  await user.type(screen.getByLabelText(/API Key/), 'secret')
  const save = screen.getByRole('button', { name: 'common.operation.save' })
  await user.dblClick(save)
  expect(save).toBeDisabled()
  expect(saveCommand).toHaveBeenCalledOnce()
  await user.keyboard('{Escape}')
  expect(screen.getByRole('dialog', { name: 'plugin.auth.useApiAuth' })).toBeVisible()
  expect(onOpenChange).not.toHaveBeenCalled()
  expect(onClose).not.toHaveBeenCalled()
  expect(onCreated).not.toHaveBeenCalled()

  request.resolve({ credentialId: 'new-api-key' })
  await waitFor(() => expect(onCreated).toHaveBeenCalledExactlyOnceWith('new-api-key'))
  expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
  expect(onClose).toHaveBeenCalledOnce()
})

it('keeps the credentials popover open while editing inside its nested modal', async () => {
  const user = userEvent.setup()
  const onClose = vi.fn()
  const onPopoverClose = vi.fn()
  const Harness = () => {
    const [open, setOpen] = useState(true)
    return (
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) onPopoverClose()
        }}
      >
        <PopoverTrigger render={<button>Credentials</button>} />
        <PopoverContent>
          <ApiKeyModal
            pluginPayload={payload}
            open={open}
            onOpenChange={setOpen}
            onClose={onClose}
          />
        </PopoverContent>
      </Popover>
    )
  }
  render(<Harness />)
  await user.type(await screen.findByLabelText(/API Key/), 'secret')
  expect(screen.getByLabelText(/API Key/)).toHaveValue('secret')
  expect(onClose).not.toHaveBeenCalled()
  expect(onPopoverClose).not.toHaveBeenCalled()
})

it('does not report a new connection when an API key replacement returns an identity', async () => {
  const user = userEvent.setup()
  const save = vi.fn().mockResolvedValue({ credentialId: 'existing-key' })
  const onCreated = vi.fn()
  const onClose = vi.fn()
  render(
    <ApiKeyModal
      dataSource={{ schemas, save }}
      editValues={{
        api_key: '[__HIDDEN__]',
        __credential_id__: 'existing-key',
        __name__: 'Existing',
      }}
      onCreated={onCreated}
      onClose={onClose}
    />,
  )
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  expect(save).toHaveBeenCalledOnce()
  expect(onCreated).not.toHaveBeenCalled()
})
