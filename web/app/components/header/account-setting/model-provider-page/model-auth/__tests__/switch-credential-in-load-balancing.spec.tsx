import type {
  CustomModel,
  ModelProvider,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { render } from '@/test/console/render'
import SwitchCredentialInLoadBalancing from '../switch-credential-in-load-balancing'

const mockWorkspacePermissionKeys = vi.hoisted(() => ({
  value: ['credential.use', 'credential.create', 'credential.manage'],
}))

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: mockWorkspacePermissionKeys.value,
  }))
})

const mockHandleOpenModal = vi.fn()
const mockOpenConfirmDelete = vi.fn()
vi.mock('../hooks', () => ({
  useAuth: () => ({
    openConfirmDelete: mockOpenConfirmDelete,
    closeConfirmDelete: vi.fn(),
    doingAction: false,
    handleActiveCredential: vi.fn(),
    handleConfirmDelete: vi.fn(),
    deleteCredentialId: null,
    handleOpenModal: mockHandleOpenModal,
  }),
}))

describe('SwitchCredentialInLoadBalancing', () => {
  const mockProvider = {
    provider: 'openai',
    allow_custom_token: true,
  } as unknown as ModelProvider

  const mockModel: CustomModel = {
    model: 'gpt-4',
    model_type: ModelTypeEnum.textGeneration,
  }

  const mockCredentials = [
    { credential_id: 'cred-1', credential_name: 'Key 1' },
    { credential_id: 'cred-2', credential_name: 'Key 2' },
  ]

  const mockSetCustomModelCredential = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkspacePermissionKeys.value = ['credential.use', 'credential.create', 'credential.manage']
  })

  it('should render auth removed status when selected credential is not in list', () => {
    render(
      <SwitchCredentialInLoadBalancing
        provider={mockProvider}
        model={mockModel}
        credentials={mockCredentials}
        customModelCredential={{ credential_id: 'dead-cred', credential_name: 'Dead Key' }}
        setCustomModelCredential={mockSetCustomModelCredential}
      />,
    )

    expect(screen.getByText(/modelProvider.auth.authRemoved/))!.toBeInTheDocument()
  })

  it('should render add credential status when credentials list is empty and create is allowed', async () => {
    const user = userEvent.setup()
    render(
      <SwitchCredentialInLoadBalancing
        provider={mockProvider}
        model={mockModel}
        credentials={[]}
        customModelCredential={undefined}
        setCustomModelCredential={mockSetCustomModelCredential}
      />,
    )

    await user.click(screen.getByRole('button', { name: /modelProvider.auth.addCredential/ }))
    expect(mockHandleOpenModal).toHaveBeenCalledOnce()
  })

  it('should call setCustomModelCredential when an item is selected in Authorized', async () => {
    const user = userEvent.setup()
    render(
      <SwitchCredentialInLoadBalancing
        provider={mockProvider}
        model={mockModel}
        credentials={mockCredentials}
        customModelCredential={mockCredentials[0]}
        setCustomModelCredential={mockSetCustomModelCredential}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Key 1' }))
    expect(mockSetCustomModelCredential).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Key 2' }))
    expect(mockSetCustomModelCredential).toHaveBeenCalledExactlyOnceWith(mockCredentials[1])
    expect(screen.queryByRole('button', { name: 'Key 2' })).not.toBeInTheDocument()
  })

  it('should keep credential menu available for manage-only users without allowing selection', async () => {
    const user = userEvent.setup()
    mockWorkspacePermissionKeys.value = ['credential.manage']

    render(
      <SwitchCredentialInLoadBalancing
        provider={mockProvider}
        model={mockModel}
        credentials={mockCredentials}
        customModelCredential={mockCredentials[0]}
        setCustomModelCredential={mockSetCustomModelCredential}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Key 1' }))
    expect(screen.queryByRole('button', { name: 'Key 2' })).not.toBeInTheDocument()
    expect(screen.getByText('Key 2')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /addModelCredential/ })).not.toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: /operation.edit/ })[0]!)
    expect(mockHandleOpenModal).toHaveBeenCalledWith(mockCredentials[0], mockModel)

    expect(mockSetCustomModelCredential).not.toHaveBeenCalled()
  })

  it('should show tooltip when empty and custom credentials not allowed', async () => {
    const user = userEvent.setup()
    const restrictedProvider = { ...mockProvider, allow_custom_token: false }
    render(
      <SwitchCredentialInLoadBalancing
        provider={restrictedProvider}
        model={mockModel}
        credentials={[]}
        customModelCredential={undefined}
        setCustomModelCredential={mockSetCustomModelCredential}
      />,
    )

    await user.hover(screen.getByRole('button', { name: /auth.credentialUnavailableInButton/ }))
    expect(await screen.findByText('plugin.auth.credentialUnavailable')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /auth.credentialUnavailableInButton/ }))
    expect(mockHandleOpenModal).not.toHaveBeenCalled()
  })

  it('should show unavailable button text when credential has not_allowed_to_use=true', () => {
    const unavailableCredential = {
      credential_id: 'cred-1',
      credential_name: 'Key 1',
      not_allowed_to_use: true,
    }

    render(
      <SwitchCredentialInLoadBalancing
        provider={mockProvider}
        model={mockModel}
        credentials={[unavailableCredential]}
        customModelCredential={unavailableCredential}
        setCustomModelCredential={mockSetCustomModelCredential}
      />,
    )

    expect(screen.getByText(/auth.credentialUnavailableInButton/))!.toBeInTheDocument()
  })

  it('should show Enterprise badge when selected credential has from_enterprise=true', () => {
    const enterpriseCredential = {
      credential_id: 'cred-1',
      credential_name: 'Enterprise Key',
      from_enterprise: true,
    }

    render(
      <SwitchCredentialInLoadBalancing
        provider={mockProvider}
        model={mockModel}
        credentials={[enterpriseCredential]}
        customModelCredential={enterpriseCredential}
        setCustomModelCredential={mockSetCustomModelCredential}
      />,
    )

    expect(screen.getByText('Enterprise'))!.toBeInTheDocument()
  })
})
