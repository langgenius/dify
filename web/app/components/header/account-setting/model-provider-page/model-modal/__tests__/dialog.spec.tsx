import type { ReactNode } from 'react'
import type { Credential, ModelProvider } from '../../declarations'
import { act, render, screen } from '@testing-library/react'
import { ConfigurationMethodEnum, ModelModalModeEnum } from '../../declarations'
import ModelModal from '../index'

type DialogProps = {
  children: ReactNode
  onOpenChange?: (open: boolean) => void
}

type AlertDialogProps = {
  children: ReactNode
  onOpenChange?: (open: boolean) => void
}

let mockLanguage = 'en_US'
let latestDialogOnOpenChange: DialogProps['onOpenChange']
let latestAlertDialogOnOpenChange: AlertDialogProps['onOpenChange']
let mockAvailableCredentials: Credential[] | undefined = []
let mockDeleteCredentialId: string | null = null

const mockCloseConfirmDelete = vi.fn()
const mockHandleConfirmDelete = vi.fn()

vi.mock('@/app/components/base/form/form-scenarios/auth', () => ({
  default: () => <div data-testid="auth-form" />,
}))

vi.mock('../../model-auth', () => ({
  CredentialSelector: ({ credentials }: { credentials: Credential[] }) => <div>{`credentials:${credentials.length}`}</div>,
}))

vi.mock('@/app/components/base/ui/dialog', () => ({
  Dialog: ({ children, onOpenChange }: DialogProps) => {
    latestDialogOnOpenChange = onOpenChange
    return <div>{children}</div>
  },
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogCloseButton: () => <button type="button">close</button>,
}))

vi.mock('@/app/components/base/ui/alert-dialog', () => ({
  AlertDialog: ({ children, onOpenChange }: AlertDialogProps) => {
    latestAlertDialogOnOpenChange = onOpenChange
    return <div>{children}</div>
  },
  AlertDialogActions: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogCancelButton: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
  AlertDialogConfirmButton: ({ children, onClick }: { children: ReactNode, onClick?: () => void }) => <button type="button" onClick={onClick}>{children}</button>,
  AlertDialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('../../model-auth/hooks', () => ({
  useCredentialData: () => ({
    isLoading: false,
    credentialData: {
      credentials: {},
      available_credentials: mockAvailableCredentials,
    },
  }),
  useAuth: () => ({
    handleSaveCredential: vi.fn(),
    handleConfirmDelete: mockHandleConfirmDelete,
    deleteCredentialId: mockDeleteCredentialId,
    closeConfirmDelete: mockCloseConfirmDelete,
    openConfirmDelete: vi.fn(),
    doingAction: false,
    handleActiveCredential: vi.fn(),
  }),
  useModelFormSchemas: () => ({
    formSchemas: [],
    formValues: {},
    modelNameAndTypeFormSchemas: [],
    modelNameAndTypeFormValues: {},
  }),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceManager: true,
  }),
}))

vi.mock('@/hooks/use-i18n', () => ({
  useRenderI18nObject: () => (value: Record<string, string>) => value[mockLanguage] || value.en_US,
}))

vi.mock('../../hooks', () => ({
  useLanguage: () => mockLanguage,
}))

const createProvider = (overrides: Partial<ModelProvider> = {}): ModelProvider => ({
  provider: 'openai',
  label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
  help: {
    title: { en_US: 'Help', zh_Hans: '帮助' },
    url: { en_US: 'https://example.com', zh_Hans: 'https://example.cn' },
  },
  icon_small: { en_US: '', zh_Hans: '' },
  supported_model_types: [],
  configurate_methods: [],
  provider_credential_schema: { credential_form_schemas: [] },
  model_credential_schema: {
    model: { label: { en_US: 'Model', zh_Hans: '模型' }, placeholder: { en_US: 'Select', zh_Hans: '选择' } },
    credential_form_schemas: [],
  },
  custom_configuration: {
    status: 'active',
    available_credentials: [],
    custom_models: [],
    can_added_models: [],
  },
  system_configuration: {
    enabled: true,
    current_quota_type: 'trial',
    quota_configurations: [],
  },
  allow_custom_token: true,
  ...overrides,
} as unknown as ModelProvider)

describe('ModelModal dialog branches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLanguage = 'en_US'
    latestDialogOnOpenChange = undefined
    latestAlertDialogOnOpenChange = undefined
    mockAvailableCredentials = []
    mockDeleteCredentialId = null
  })

  it('should only cancel when the dialog reports it has closed', () => {
    const onCancel = vi.fn()
    render(
      <ModelModal
        provider={createProvider()}
        configurateMethod={ConfigurationMethodEnum.predefinedModel}
        onCancel={onCancel}
        onSave={vi.fn()}
        onRemove={vi.fn()}
      />,
    )

    act(() => {
      latestDialogOnOpenChange?.(true)
      latestDialogOnOpenChange?.(false)
    })

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('should only close the confirm dialog when the alert dialog closes', () => {
    mockDeleteCredentialId = 'cred-1'

    render(
      <ModelModal
        provider={createProvider()}
        configurateMethod={ConfigurationMethodEnum.predefinedModel}
        onCancel={vi.fn()}
        onSave={vi.fn()}
        onRemove={vi.fn()}
      />,
    )

    act(() => {
      latestAlertDialogOnOpenChange?.(true)
      latestAlertDialogOnOpenChange?.(false)
    })

    expect(mockCloseConfirmDelete).toHaveBeenCalledTimes(1)
  })

  it('should pass an empty credential list to the selector when no credentials are available', () => {
    mockAvailableCredentials = undefined

    render(
      <ModelModal
        provider={createProvider()}
        configurateMethod={ConfigurationMethodEnum.predefinedModel}
        mode={ModelModalModeEnum.addCustomModelToModelList}
        onCancel={vi.fn()}
        onSave={vi.fn()}
        onRemove={vi.fn()}
      />,
    )

    expect(screen.getByText('credentials:0')).toBeInTheDocument()
  })

  it('should hide the help link when provider help is missing', () => {
    render(
      <ModelModal
        provider={createProvider({ help: undefined })}
        configurateMethod={ConfigurationMethodEnum.predefinedModel}
        onCancel={vi.fn()}
        onSave={vi.fn()}
        onRemove={vi.fn()}
      />,
    )

    expect(screen.queryByRole('link', { name: 'Help' })).not.toBeInTheDocument()
  })

  it('should prevent navigation when help text exists without a help url', () => {
    mockLanguage = 'zh_Hans'

    render(
      <ModelModal
        provider={createProvider({
          help: {
            title: { en_US: 'English Help' },
            url: '' as unknown as ModelProvider['help']['url'],
          } as ModelProvider['help'],
        })}
        configurateMethod={ConfigurationMethodEnum.predefinedModel}
        onCancel={vi.fn()}
        onSave={vi.fn()}
        onRemove={vi.fn()}
      />,
    )

    const link = screen.getByText('English Help').closest('a')
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true })
    expect(link).not.toBeNull()
    link!.dispatchEvent(clickEvent)

    expect(clickEvent.defaultPrevented).toBe(true)
  })

  it('should fall back to localized and english help urls when titles are missing', () => {
    mockLanguage = 'zh_Hans'
    const { rerender } = render(
      <ModelModal
        provider={createProvider({
          help: {
            url: { zh_Hans: 'https://example.cn', en_US: 'https://example.com' },
          } as ModelProvider['help'],
        })}
        configurateMethod={ConfigurationMethodEnum.predefinedModel}
        onCancel={vi.fn()}
        onSave={vi.fn()}
        onRemove={vi.fn()}
      />,
    )

    expect(screen.getByRole('link', { name: 'https://example.cn' })).toHaveAttribute('href', 'https://example.cn')

    rerender(
      <ModelModal
        provider={createProvider({
          help: {
            url: { en_US: 'https://example.com' },
          } as ModelProvider['help'],
        })}
        configurateMethod={ConfigurationMethodEnum.predefinedModel}
        onCancel={vi.fn()}
        onSave={vi.fn()}
        onRemove={vi.fn()}
      />,
    )

    const link = screen.getByRole('link', { name: 'https://example.com' })
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true })
    link.dispatchEvent(clickEvent)

    expect(link).toHaveAttribute('href', 'https://example.com')
    expect(clickEvent.defaultPrevented).toBe(false)
  })
})
