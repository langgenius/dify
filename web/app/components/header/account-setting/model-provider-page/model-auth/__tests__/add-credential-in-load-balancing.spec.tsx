import type { CustomModel, ModelCredential, ModelProvider } from '../../declarations'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { ConfigurationMethodEnum, ModelTypeEnum } from '../../declarations'
import AddCredentialInLoadBalancing from '../add-credential-in-load-balancing'

const { openModal } = vi.hoisted(() => ({ openModal: vi.fn() }))

// Modal persistence is outside the credential menu; keep the menu and permission hooks real.
vi.mock('../hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks')>()),
  useAuth: () => ({
    handleOpenModal: openModal,
    openConfirmDelete: vi.fn(),
    closeConfirmDelete: vi.fn(),
    handleActiveCredential: vi.fn(),
    handleConfirmDelete: vi.fn(),
    deleteCredentialId: null,
    doingAction: false,
  }),
}))

const provider = { provider: 'openai', allow_custom_token: true } as ModelProvider
const model = { model: 'gpt-4', model_type: ModelTypeEnum.textGeneration } as CustomModel
const credential = { credential_id: 'cred-1', credential_name: 'Key 1' }
const modelCredential = {
  available_credentials: [credential],
  credentials: {},
  load_balancing: { enabled: false, configs: [] },
} as ModelCredential

const renderMenu = (permissions: string[], availableCredentials = [credential]) => {
  const onSelectCredential = vi.fn()
  renderWithConsoleQuery(
    <AddCredentialInLoadBalancing
      provider={provider}
      model={model}
      configurationMethod={ConfigurationMethodEnum.customizableModel}
      modelCredential={{ ...modelCredential, available_credentials: availableCredentials }}
      onSelectCredential={onSelectCredential}
    />,
    { workspacePermissionKeys: permissions },
  )
  return onSelectCredential
}

describe('AddCredentialInLoadBalancing', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lets use-only users choose an existing credential without exposing creation or management', async () => {
    const user = userEvent.setup()
    const onSelect = renderMenu(['credential.use'])
    await user.click(screen.getByRole('button', { name: /auth.addCredential/ }))
    expect(screen.queryByText(/auth.addModelCredential/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.operation.edit' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'common.operation.delete' }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Key 1' }))
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(credential, model)
  })

  it('lets manage-only users edit an existing credential without selecting or creating one', async () => {
    const user = userEvent.setup()
    const onSelect = renderMenu(['credential.manage'])
    await user.click(screen.getByRole('button', { name: /auth.addCredential/ }))
    expect(screen.queryByText(/auth.addModelCredential/)).not.toBeInTheDocument()
    await user.click(screen.getByText('Key 1'))
    expect(onSelect).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
    expect(openModal).toHaveBeenCalledExactlyOnceWith(credential, model)
  })

  it.each([{ permissions: [] }, { permissions: ['credential.manage'] }])(
    'hides an empty menu without creation or use permission: %j',
    ({ permissions }) => {
      renderMenu(permissions, [])
      expect(screen.queryByRole('button', { name: /auth.addCredential/ })).not.toBeInTheDocument()
    },
  )

  it('opens credential creation directly when there are no existing credentials', async () => {
    const user = userEvent.setup()
    renderMenu(['credential.create'], [])
    await user.click(screen.getByRole('button', { name: /auth.addCredential/ }))
    expect(openModal).toHaveBeenCalledExactlyOnceWith()
    expect(screen.queryByText('Key 1')).not.toBeInTheDocument()
  })
})
