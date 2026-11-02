import type { ComponentProps } from 'react'
import type { Credential } from '../../types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { CredentialTypeEnum } from '../../types'
import Item from '../item'

const createCredential = (overrides: Partial<Credential> = {}): Credential => ({
  id: 'credential-id',
  name: 'Test Credential',
  provider: 'test-provider',
  credential_type: CredentialTypeEnum.API_KEY,
  is_default: false,
  credentials: { api_key: 'test-key' },
  ...overrides,
})
const renderItem = (props: Partial<ComponentProps<typeof Item>> = {}) =>
  renderWithConsoleQuery(<Item credential={createCredential()} {...props} />, {
    workspacePermissionKeys: ['credential.use', 'credential.create', 'credential.manage'],
  })

it.each([
  ['credential-id', 'credential-id'],
  ['__workspace_default__', ''],
])('selects %s with the corresponding credential reference', async (id, expected) => {
  const user = userEvent.setup()
  const onItemClick = vi.fn()
  renderItem({ credential: createCredential({ id }), onItemClick })
  await user.click(screen.getByText('Test Credential'))
  expect(onItemClick).toHaveBeenCalledExactlyOnceWith(expected)
})

it.each([{ disabled: true }, { credential: createCredential({ not_allowed_to_use: true }) }])(
  'does not select a disabled credential (%j)',
  async (props) => {
    const user = userEvent.setup()
    const onItemClick = vi.fn()
    renderItem({ ...props, onItemClick })
    await user.click(screen.getByText('Test Credential'))
    expect(onItemClick).not.toHaveBeenCalled()
  },
)

it('discards a cancelled rename and saves the new name without selecting the row', async () => {
  const user = userEvent.setup()
  const onRename = vi.fn()
  const onItemClick = vi.fn()
  renderItem({ onRename, onItemClick })
  await user.click(screen.getByRole('button', { name: 'common.operation.rename' }))
  const input = screen.getByRole('textbox', { name: 'common.operation.rename' })
  await user.clear(input)
  await user.type(input, 'Discarded name')
  await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(onRename).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'common.operation.rename' }))
  const reopened = screen.getByRole('textbox', { name: 'common.operation.rename' })
  expect(reopened).toHaveValue('Test Credential')
  await user.clear(reopened)
  await user.type(reopened, 'New name')
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  expect(onRename).toHaveBeenCalledExactlyOnceWith({
    credential_id: 'credential-id',
    name: 'New name',
  })
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(onItemClick).not.toHaveBeenCalled()
})

it('routes default, edit and delete actions without selecting the credential', async () => {
  const user = userEvent.setup()
  const onSetDefault = vi.fn()
  const onEdit = vi.fn()
  const onDelete = vi.fn()
  const onItemClick = vi.fn()
  renderItem({ onSetDefault, onEdit, onDelete, onItemClick })
  await user.click(screen.getByRole('button', { name: 'plugin.auth.setDefault' }))
  expect(onSetDefault).toHaveBeenCalledExactlyOnceWith('credential-id')
  await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
  expect(onEdit).toHaveBeenCalledExactlyOnceWith('credential-id', {
    api_key: 'test-key',
    __name__: 'Test Credential',
    __credential_id__: 'credential-id',
  })
  await user.click(screen.getByRole('button', { name: 'common.operation.delete' }))
  expect(onDelete).toHaveBeenCalledExactlyOnceWith('credential-id')
  expect(onItemClick).not.toHaveBeenCalled()
})

it('marks the default credential and omits its redundant set-default action', () => {
  renderItem({ credential: createCredential({ is_default: true }) })
  expect(screen.getByText('plugin.auth.default')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'plugin.auth.setDefault' })).not.toBeInTheDocument()
})

it('shows enterprise ownership and omits local management actions', () => {
  renderItem({ credential: createCredential({ from_enterprise: true }) })
  expect(screen.getByText('plugin.auth.enterprise')).toBeInTheDocument()
  for (const action of ['rename', 'edit', 'delete'])
    expect(
      screen.queryByRole('button', { name: `common.operation.${action}` }),
    ).not.toBeInTheDocument()
})

it('keeps OAuth credentials renameable and removable without exposing secret editing', () => {
  renderItem({ credential: createCredential({ credential_type: CredentialTypeEnum.OAUTH2 }) })
  expect(screen.queryByRole('button', { name: 'common.operation.edit' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'common.operation.rename' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'common.operation.delete' })).toBeEnabled()
})

it('lets an unavailable credential be removed but not renamed, edited or made default', () => {
  renderItem({ credential: createCredential({ not_allowed_to_use: true }) })
  for (const name of ['common.operation.rename', 'common.operation.edit', 'plugin.auth.setDefault'])
    expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'common.operation.delete' })).toBeEnabled()
})

it('omits actions explicitly disabled by the owning selector', () => {
  renderItem({
    disableRename: true,
    disableEdit: true,
    disableDelete: true,
    disableSetDefault: true,
  })
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})
