import type { CustomModel, ModelCredential, ModelProvider } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { fireEvent, render, screen } from '@testing-library/react'
import { ConfigurationMethodEnum, ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import AddCredentialInLoadBalancing from './add-credential-in-load-balancing'

vi.mock('@/app/components/header/account-setting/model-provider-page/model-auth', () => ({
  Authorized: ({
    renderTrigger,
    authParams,
    items,
    onItemClick,
  }: {
    renderTrigger: (open?: boolean) => React.ReactNode
    authParams?: { onUpdate?: (payload?: unknown, formValues?: Record<string, unknown>) => void }
    items: Array<{ credentials: Array<{ credential_id: string, credential_name: string }> }>
    onItemClick?: (credential: { credential_id: string, credential_name: string }) => void
  }) => (
    <div>
      {renderTrigger(false)}
      <button onClick={() => authParams?.onUpdate?.({ provider: 'x' }, { key: 'value' })}>Run update</button>
      <button onClick={() => onItemClick?.(items[0].credentials[0])}>Select first</button>
    </div>
  ),
}))

describe('AddCredentialInLoadBalancing', () => {
  const provider = {
    provider: 'openai',
    allow_custom_token: true,
  } as ModelProvider

  const model = {
    model: 'gpt-4',
    model_type: ModelTypeEnum.textGeneration,
  } as CustomModel

  const modelCredential = {
    available_credentials: [
      { credential_id: 'cred-1', credential_name: 'Key 1' },
    ],
    credentials: {},
    load_balancing: { enabled: false, configs: [] },
  } as ModelCredential

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render add credential label', () => {
    render(
      <AddCredentialInLoadBalancing
        provider={provider}
        model={model}
        configurationMethod={ConfigurationMethodEnum.predefinedModel}
        modelCredential={modelCredential}
        onSelectCredential={vi.fn()}
      />,
    )

    expect(screen.getByText(/modelProvider.auth.addCredential/i)).toBeInTheDocument()
  })

  it('should forward update payload when update action happens', () => {
    const onUpdate = vi.fn()

    render(
      <AddCredentialInLoadBalancing
        provider={provider}
        model={model}
        configurationMethod={ConfigurationMethodEnum.predefinedModel}
        modelCredential={modelCredential}
        onSelectCredential={vi.fn()}
        onUpdate={onUpdate}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Run update' }))

    expect(onUpdate).toHaveBeenCalledWith({ provider: 'x' }, { key: 'value' })
  })

  it('should call onSelectCredential when user picks a credential', () => {
    const onSelectCredential = vi.fn()

    render(
      <AddCredentialInLoadBalancing
        provider={provider}
        model={model}
        configurationMethod={ConfigurationMethodEnum.customizableModel}
        modelCredential={modelCredential}
        onSelectCredential={onSelectCredential}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Select first' }))

    expect(onSelectCredential).toHaveBeenCalledWith(modelCredential.available_credentials[0])
  })
})
