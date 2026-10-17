import type { ComponentPropsWithRef } from 'react'
import type { Credential, ModelProvider } from '../../../declarations'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/console/render'
import { ConfigurationMethodEnum, ModelTypeEnum } from '../../../declarations'
import Authorized from '../index'

const mockHandleOpenModal = vi.fn()
const mockHandleActiveCredential = vi.fn()
const mockOpenConfirmDelete = vi.fn()
const mockCloseConfirmDelete = vi.fn()
const mockHandleConfirmDelete = vi.fn()

let mockDeleteCredentialId: string | null = null
let mockDoingAction = false
let mockWorkspacePermissionKeys = ['credential.use', 'credential.create', 'credential.manage']

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: mockWorkspacePermissionKeys,
  }))
})

vi.mock('../../hooks', () => ({
  useAuth: () => ({
    openConfirmDelete: mockOpenConfirmDelete,
    closeConfirmDelete: mockCloseConfirmDelete,
    doingAction: mockDoingAction,
    handleActiveCredential: mockHandleActiveCredential,
    handleConfirmDelete: mockHandleConfirmDelete,
    deleteCredentialId: mockDeleteCredentialId,
    handleOpenModal: mockHandleOpenModal,
  }),
}))

describe('Authorized', () => {
  const mockProvider: ModelProvider = {
    provider: 'openai',
    allow_custom_token: true,
  } as ModelProvider

  const mockCredentials: Credential[] = [
    { credential_id: 'cred-1', credential_name: 'API Key 1' },
    { credential_id: 'cred-2', credential_name: 'API Key 2' },
  ]

  const mockItems = [
    {
      model: {
        model: 'gpt-4',
        model_type: ModelTypeEnum.textGeneration,
      },
      credentials: mockCredentials,
    },
  ]

  const mockRenderTrigger = (open: boolean, triggerProps: ComponentPropsWithRef<'button'>) => (
    <button {...triggerProps} type="button">
      Trigger
      {open ? 'Open' : 'Closed'}
    </button>
  )

  const getTrigger = () => screen.getByRole('button', { name: /trigger\s*(open|closed)/i })

  beforeEach(() => {
    vi.clearAllMocks()
    mockDeleteCredentialId = null
    mockDoingAction = false
    mockWorkspacePermissionKeys = ['credential.use', 'credential.create', 'credential.manage']
  })

  it('should render trigger and open popup when trigger is clicked', async () => {
    render(
      <Authorized
        provider={mockProvider}
        configurationMethod={ConfigurationMethodEnum.predefinedModel}
        items={mockItems}
        renderTrigger={mockRenderTrigger}
      />,
    )

    const trigger = getTrigger()
    expect(screen.queryByRole('button', { name: 'API Key 1' })).not.toBeInTheDocument()

    await userEvent.setup().click(trigger)

    expect(trigger.textContent).toMatch(/trigger\s*open/i)
    expect(screen.getByRole('button', { name: 'API Key 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /addApiKey/i }))!.toBeInTheDocument()
  })

  it('should call handleOpenModal when triggerOnlyOpenModal is true', async () => {
    render(
      <Authorized
        provider={mockProvider}
        configurationMethod={ConfigurationMethodEnum.predefinedModel}
        items={mockItems}
        renderTrigger={mockRenderTrigger}
        triggerOnlyOpenModal
      />,
    )

    await userEvent.setup().click(getTrigger())
    expect(mockHandleOpenModal).toHaveBeenCalled()
  })

  it('should call onItemClick when credential is selected', async () => {
    const onItemClick = vi.fn()
    render(
      <Authorized
        provider={mockProvider}
        configurationMethod={ConfigurationMethodEnum.predefinedModel}
        items={mockItems}
        renderTrigger={mockRenderTrigger}
        onItemClick={onItemClick}
      />,
    )

    await userEvent.setup().click(getTrigger())
    await userEvent.setup().click(screen.getByRole('button', { name: 'API Key 1' }))

    expect(onItemClick).toHaveBeenCalledWith(mockCredentials[0], mockItems[0]!.model)
  })

  it('should call handleActiveCredential when onItemClick is not provided', async () => {
    render(
      <Authorized
        provider={mockProvider}
        configurationMethod={ConfigurationMethodEnum.predefinedModel}
        items={mockItems}
        renderTrigger={mockRenderTrigger}
      />,
    )

    await userEvent.setup().click(getTrigger())
    await userEvent.setup().click(screen.getByRole('button', { name: 'API Key 1' }))

    expect(mockHandleActiveCredential).toHaveBeenCalledWith(mockCredentials[0], mockItems[0]!.model)
  })

  it('should call handleOpenModal with fixed model fields when adding model credential', async () => {
    render(
      <Authorized
        provider={mockProvider}
        configurationMethod={ConfigurationMethodEnum.customizableModel}
        items={mockItems}
        renderTrigger={mockRenderTrigger}
        authParams={{ isModelCredential: true }}
        currentCustomConfigurationModelFixedFields={{
          __model_name: 'gpt-4',
          __model_type: ModelTypeEnum.textGeneration,
        }}
      />,
    )

    await userEvent.setup().click(getTrigger())
    const addCredential = screen.getByRole('button', { name: /addModelCredential/ })
    addCredential.focus()
    await userEvent.setup().keyboard('{Enter}')

    expect(mockHandleOpenModal).toHaveBeenCalledWith(undefined, {
      model: 'gpt-4',
      model_type: ModelTypeEnum.textGeneration,
    })
  })

  it('should not render add action when hideAddAction is true', async () => {
    render(
      <Authorized
        provider={mockProvider}
        configurationMethod={ConfigurationMethodEnum.predefinedModel}
        items={mockItems}
        renderTrigger={mockRenderTrigger}
        hideAddAction
      />,
    )

    await userEvent.setup().click(getTrigger())
    expect(screen.queryByRole('button', { name: /addApiKey/i })).not.toBeInTheDocument()
  })

  it('should allow use-only users to switch credentials but not add, edit, or delete them', async () => {
    mockWorkspacePermissionKeys = ['credential.use']

    render(
      <Authorized
        provider={mockProvider}
        configurationMethod={ConfigurationMethodEnum.predefinedModel}
        items={mockItems}
        renderTrigger={mockRenderTrigger}
      />,
    )

    await userEvent.setup().click(getTrigger())
    expect(screen.queryByRole('button', { name: /operation.edit/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /operation.delete/ })).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'API Key 1' }))

    expect(mockHandleActiveCredential).toHaveBeenCalledWith(mockCredentials[0], mockItems[0]!.model)
    expect(mockHandleOpenModal).not.toHaveBeenCalled()
    expect(mockOpenConfirmDelete).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /addApiKey/i })).not.toBeInTheDocument()
  })

  it('should allow create-only users to add credentials but not switch, edit, or delete existing credentials', async () => {
    mockWorkspacePermissionKeys = ['credential.create']

    render(
      <Authorized
        provider={mockProvider}
        configurationMethod={ConfigurationMethodEnum.predefinedModel}
        items={mockItems}
        renderTrigger={mockRenderTrigger}
      />,
    )

    await userEvent.setup().click(getTrigger())
    expect(screen.queryByRole('button', { name: /operation.edit/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /operation.delete/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'API Key 1' })).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: /addApiKey/i }))

    expect(mockHandleActiveCredential).not.toHaveBeenCalled()
    expect(mockOpenConfirmDelete).not.toHaveBeenCalled()
    expect(mockHandleOpenModal).toHaveBeenCalledTimes(1)
    expect(mockHandleOpenModal).toHaveBeenCalledWith(undefined, undefined)
  })

  it('should allow manage-only users to edit and delete credentials but not switch or add them', async () => {
    mockWorkspacePermissionKeys = ['credential.manage']

    render(
      <Authorized
        provider={mockProvider}
        configurationMethod={ConfigurationMethodEnum.predefinedModel}
        items={mockItems}
        renderTrigger={mockRenderTrigger}
      />,
    )

    await userEvent.setup().click(getTrigger())
    await userEvent.setup().click(screen.getAllByRole('button', { name: /operation.edit/ })[0]!)
    await userEvent.setup().click(getTrigger())
    await userEvent.setup().click(screen.getAllByRole('button', { name: /operation.delete/ })[0]!)
    await userEvent.setup().click(getTrigger())
    expect(screen.queryByRole('button', { name: 'API Key 1' })).not.toBeInTheDocument()

    expect(mockHandleOpenModal).toHaveBeenCalledWith(mockCredentials[0], mockItems[0]!.model)
    expect(mockOpenConfirmDelete).toHaveBeenCalledWith(mockCredentials[0], mockItems[0]!.model)
    expect(mockHandleActiveCredential).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /addApiKey/i })).not.toBeInTheDocument()
  })

  it('should show confirm dialog and call confirm handler when delete is confirmed', async () => {
    mockDeleteCredentialId = 'cred-1'

    render(
      <Authorized
        provider={mockProvider}
        configurationMethod={ConfigurationMethodEnum.predefinedModel}
        items={mockItems}
        renderTrigger={mockRenderTrigger}
      />,
    )

    await userEvent.setup().click(screen.getByRole('button', { name: /common.operation.confirm/i }))
    expect(mockHandleConfirmDelete).toHaveBeenCalled()
  })

  it('should close confirm dialog when deletion is cancelled', async () => {
    mockDeleteCredentialId = 'cred-1'

    render(
      <Authorized
        provider={mockProvider}
        configurationMethod={ConfigurationMethodEnum.predefinedModel}
        items={mockItems}
        renderTrigger={mockRenderTrigger}
      />,
    )

    const dialog = screen.getByRole('alertdialog')
    await userEvent.setup().click(within(dialog).getByRole('button', { name: /operation.cancel/i }))

    expect(mockCloseConfirmDelete).toHaveBeenCalledTimes(1)
  })

  it('should disable the confirm button while deletion is in progress', () => {
    mockDeleteCredentialId = 'cred-1'
    mockDoingAction = true

    render(
      <Authorized
        provider={mockProvider}
        configurationMethod={ConfigurationMethodEnum.predefinedModel}
        items={mockItems}
        renderTrigger={mockRenderTrigger}
      />,
    )

    const dialog = screen.getByRole('alertdialog')
    expect(
      within(dialog).getByRole('button', { name: /common.operation.confirm/i }),
    )!.toBeDisabled()
  })
  it.each([
    { label: 'provider disallows custom credentials', allowCustomToken: false, disabled: false },
    { label: 'control is disabled', allowCustomToken: true, disabled: true },
  ])('does not open credential creation when $label', async ({ allowCustomToken, disabled }) => {
    render(
      <Authorized
        provider={{ ...mockProvider, allow_custom_token: allowCustomToken }}
        configurationMethod={ConfigurationMethodEnum.predefinedModel}
        items={[]}
        renderTrigger={mockRenderTrigger}
        triggerOnlyOpenModal
        disabled={disabled}
      />,
    )
    await userEvent.setup().click(getTrigger())
    expect(mockHandleOpenModal).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /addApiKey/ })).not.toBeInTheDocument()
  })
})
