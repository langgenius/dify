import type { CustomModel, ModelCredential, ModelProvider } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { fireEvent, render, screen } from '@testing-library/react'
import { ConfigurationMethodEnum, ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import AddCredentialInLoadBalancing from '../add-credential-in-load-balancing'

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
      <button onClick={() => onItemClick?.(items[0]!.credentials[0]!)}>Select first</button>
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

    expect(screen.getByText(/modelProvider.auth.addCredential/i))!.toBeInTheDocument()
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

  // renderTrigger with open=true: bg-state-base-hover style applied
  it('should apply hover background when trigger is rendered with open=true', async () => {
    vi.doMock('@/app/components/header/account-setting/model-provider-page/model-auth', () => ({
      Authorized: ({
        renderTrigger,
      }: {
        renderTrigger: (open?: boolean) => React.ReactNode
      }) => (
        <div data-testid="open-trigger">{renderTrigger(true)}</div>
      ),
    }))

    // Must invalidate module cache so the component picks up the new mock
    vi.resetModules()
    try {
      const { default: AddCredentialLB } = await import('../add-credential-in-load-balancing')

      const { container } = render(
        <AddCredentialLB
          provider={provider}
          model={model}
          configurationMethod={ConfigurationMethodEnum.predefinedModel}
          modelCredential={modelCredential}
          onSelectCredential={vi.fn()}
        />,
      )

      // The trigger div rendered by renderTrigger(true) should have bg-state-base-hover
      // (the static class applied when open=true via cn())
      const triggerDiv = container.querySelector('[data-testid="open-trigger"] > div')
      expect(triggerDiv)!.toBeInTheDocument()
      expect(triggerDiv!.className).toContain('bg-state-base-hover')
    }
    finally {
      vi.doUnmock('@/app/components/header/account-setting/model-provider-page/model-auth')
      vi.resetModules()
    }
  })

  // customizableModel configuration method: component renders the add credential label
  it('should render correctly with customizableModel configuration method', () => {
    render(
      <AddCredentialInLoadBalancing
        provider={provider}
        model={model}
        configurationMethod={ConfigurationMethodEnum.customizableModel}
        modelCredential={modelCredential}
        onSelectCredential={vi.fn()}
      />,
    )

    expect(screen.getByText(/modelProvider.auth.addCredential/i))!.toBeInTheDocument()
  })

  it('should handle undefined available_credentials gracefully using nullish coalescing', () => {
    const credentialWithNoAvailable = {
      available_credentials: undefined,
      credentials: {},
      load_balancing: { enabled: false, configs: [] },
    } as unknown as typeof modelCredential

    render(
      <AddCredentialInLoadBalancing
        provider={provider}
        model={model}
        configurationMethod={ConfigurationMethodEnum.predefinedModel}
        modelCredential={credentialWithNoAvailable}
        onSelectCredential={vi.fn()}
      />,
    )

    // Component should render without error - the ?? [] fallback is used
    // Component should render without error - the ?? [] fallback is used
    expect(screen.getByText(/modelProvider.auth.addCredential/i))!.toBeInTheDocument()
  })

  it('should not throw when update action fires without onUpdate prop', () => {
    // Arrange - no onUpdate prop
    render(
      <AddCredentialInLoadBalancing
        provider={provider}
        model={model}
        configurationMethod={ConfigurationMethodEnum.predefinedModel}
        modelCredential={modelCredential}
        onSelectCredential={vi.fn()}
      />,
    )

    // Act - trigger the update without onUpdate being set (should not throw)
    expect(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Run update' }))
    }).not.toThrow()
  })
})
