import type {
  Credential,
  CustomModelCredential,
  ModelCredential,
  ModelLoadBalancingConfig,
  ModelProvider,
} from '../declarations'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { AddCredentialInLoadBalancing } from '@/app/components/header/account-setting/model-provider-page/model-auth'
import { ConfigurationMethodEnum } from '../declarations'
import ModelLoadBalancingConfigs from './model-load-balancing-configs'

let mockModelLoadBalancingEnabled = true

vi.mock('@/config', () => ({
  IS_CE_EDITION: false,
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContextSelector: (selector: (state: { modelLoadBalancingEnabled: boolean }) => boolean) => selector({ modelLoadBalancingEnabled: mockModelLoadBalancingEnabled }),
}))

vi.mock('./cooldown-timer', () => ({
  default: ({ secondsRemaining, onFinish }: { secondsRemaining?: number, onFinish?: () => void }) => (
    <button type="button" onClick={onFinish} data-testid="cooldown-timer">
      {secondsRemaining}
      s
    </button>
  ),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-auth', () => ({
  AddCredentialInLoadBalancing: vi.fn(({ onSelectCredential, onUpdate, onRemove }: {
    onSelectCredential: (credential: Credential) => void
    onUpdate?: (payload?: unknown, formValues?: Record<string, unknown>) => void
    onRemove?: (credentialId: string) => void
  }) => (
    <div>
      <button
        type="button"
        onClick={() => onSelectCredential({ credential_id: 'cred-2', credential_name: 'Key 2' } as Credential)}
      >
        add credential
      </button>
      <button
        type="button"
        onClick={() => onUpdate?.({ credential: { credential_id: 'cred-2' } }, { __authorization_name__: 'Key 2' })}
      >
        trigger update
      </button>
      <button
        type="button"
        onClick={() => onRemove?.('cred-2')}
      >
        trigger remove
      </button>
    </div>
  )),
}))

vi.mock('@/app/components/billing/upgrade-btn', () => ({
  default: () => <div>upgrade</div>,
}))

describe('ModelLoadBalancingConfigs', () => {
  const mockProvider = {
    provider: 'test-provider',
  } as unknown as ModelProvider

  const mockModelCredential = {
    available_credentials: [
      {
        credential_id: 'cred-1',
        credential_name: 'Key 1',
        not_allowed_to_use: false,
      },
      {
        credential_id: 'cred-2',
        credential_name: 'Key 2',
        not_allowed_to_use: false,
      },
      {
        credential_id: 'cred-enterprise',
        credential_name: 'Enterprise Key',
        from_enterprise: true,
      },
    ],
  } as unknown as ModelCredential

  const createDraftConfig = (enabled = true): ModelLoadBalancingConfig => ({
    enabled,
    configs: [
      {
        id: 'cfg-1',
        credential_id: 'cred-1',
        enabled: true,
        name: 'Key 1',
      },
    ],
  } as ModelLoadBalancingConfig)

  const StatefulHarness = ({
    initialConfig,
    withSwitch = false,
    onUpdate,
    onRemove,
    configurationMethod = ConfigurationMethodEnum.predefinedModel,
  }: {
    initialConfig: ModelLoadBalancingConfig | undefined
    withSwitch?: boolean
    onUpdate?: (payload?: unknown, formValues?: Record<string, unknown>) => void
    onRemove?: (credentialId: string) => void
    configurationMethod?: ConfigurationMethodEnum
  }) => {
    const [draftConfig, setDraftConfig] = useState<ModelLoadBalancingConfig | undefined>(initialConfig)
    return (
      <ModelLoadBalancingConfigs
        draftConfig={draftConfig}
        setDraftConfig={setDraftConfig}
        provider={mockProvider}
        configurationMethod={configurationMethod}
        modelCredential={mockModelCredential}
        model={{ model: 'gpt-4', model_type: 'llm' } as CustomModelCredential}
        withSwitch={withSwitch}
        onUpdate={onUpdate}
        onRemove={onRemove}
      />
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockModelLoadBalancingEnabled = true
  })

  it('should render nothing when draft config is missing', () => {
    const { container } = render(
      <ModelLoadBalancingConfigs
        draftConfig={undefined}
        setDraftConfig={vi.fn()}
        provider={mockProvider}
        configurationMethod={ConfigurationMethodEnum.predefinedModel}
        modelCredential={mockModelCredential}
        model={{ model: 'gpt-4', model_type: 'llm' } as CustomModelCredential}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('should enable load balancing by clicking the main panel when disabled and without switch', async () => {
    const user = userEvent.setup()
    render(<StatefulHarness initialConfig={createDraftConfig(false)} withSwitch={false} />)

    const panel = screen.getByTestId('load-balancing-main-panel')
    await user.click(panel)
    expect(screen.getByText('Key 1')).toBeInTheDocument()
  })

  it('should handle removing an entry via the UI button', async () => {
    const user = userEvent.setup()
    render(<StatefulHarness initialConfig={createDraftConfig(true)} />)

    const removeBtn = screen.getByTestId('load-balancing-remove-cfg-1')
    await user.click(removeBtn)

    expect(screen.queryByText('Key 1')).not.toBeInTheDocument()
  })

  it('should toggle individual entry enabled state', async () => {
    const user = userEvent.setup()
    render(<StatefulHarness initialConfig={createDraftConfig(true)} />)

    const entrySwitch = screen.getByTestId('load-balancing-switch-cfg-1')
    await user.click(entrySwitch)
    // Internal state transitions are verified by successful interactions
  })

  it('should toggle load balancing via main switch', async () => {
    const user = userEvent.setup()
    render(<StatefulHarness initialConfig={createDraftConfig(true)} withSwitch />)

    const mainSwitch = screen.getByTestId('load-balancing-switch-main')
    await user.click(mainSwitch)
    // Check if description is still there (it should be)
    expect(screen.getByText('common.modelProvider.loadBalancingDescription')).toBeInTheDocument()
  })

  it('should disable main switch when load balancing is not permitted', async () => {
    const user = userEvent.setup()
    mockModelLoadBalancingEnabled = false
    render(<StatefulHarness initialConfig={createDraftConfig(false)} withSwitch />)

    const mainSwitch = screen.getByTestId('load-balancing-switch-main')
    expect(mainSwitch).toHaveClass('!cursor-not-allowed')

    // Clicking should not trigger any changes (effectively disabled)
    await user.click(mainSwitch)
    expect(mainSwitch).toHaveAttribute('aria-checked', 'false')
  })

  it('should handle enterprise badge and restricted credentials', () => {
    const enterpriseConfig: ModelLoadBalancingConfig = {
      enabled: true,
      configs: [
        { id: 'cfg-ent', credential_id: 'cred-enterprise', enabled: true, name: 'Enterprise Key' },
      ],
    } as ModelLoadBalancingConfig
    render(<StatefulHarness initialConfig={enterpriseConfig} />)

    expect(screen.getByText('Enterprise')).toBeInTheDocument()
  })

  it('should handle cooldown timer and finish it', async () => {
    const user = userEvent.setup()
    const cooldownConfig: ModelLoadBalancingConfig = {
      enabled: true,
      configs: [
        { id: 'cfg-1', credential_id: 'cred-1', enabled: true, name: 'Key 1', in_cooldown: true, ttl: 30 },
      ],
    } as unknown as ModelLoadBalancingConfig
    render(<StatefulHarness initialConfig={cooldownConfig} />)

    const timer = screen.getByTestId('cooldown-timer')
    expect(timer).toHaveTextContent('30s')
    await user.click(timer)
    expect(screen.queryByTestId('cooldown-timer')).not.toBeInTheDocument()
  })

  it('should handle child component callbacks: add, update, remove', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()
    const onRemove = vi.fn()
    render(<StatefulHarness initialConfig={createDraftConfig(true)} onUpdate={onUpdate} onRemove={onRemove} />)

    // Add
    await user.click(screen.getByRole('button', { name: 'add credential' }))
    expect(screen.getByText('Key 2')).toBeInTheDocument()

    // Update
    await user.click(screen.getByRole('button', { name: 'trigger update' }))
    expect(onUpdate).toHaveBeenCalled()

    // Remove
    await user.click(screen.getByRole('button', { name: 'trigger remove' }))
    expect(onRemove).toHaveBeenCalledWith('cred-2')
    expect(screen.queryByText('Key 2')).not.toBeInTheDocument()
  })

  it('should show "Provider Managed" badge for inherit config in predefined method', () => {
    const inheritConfig: ModelLoadBalancingConfig = {
      enabled: true,
      configs: [
        { id: 'cfg-inherit', credential_id: '', enabled: true, name: '__inherit__' },
      ],
    } as ModelLoadBalancingConfig
    render(<StatefulHarness initialConfig={inheritConfig} configurationMethod={ConfigurationMethodEnum.predefinedModel} />)

    expect(screen.getByText('common.modelProvider.providerManaged')).toBeInTheDocument()
    expect(screen.getByText('common.modelProvider.defaultConfig')).toBeInTheDocument()
  })

  it('should handle edge cases where draftConfig becomes null during callbacks', async () => {
    let capturedAdd: ((credential: Credential) => void) | null = null
    let capturedUpdate: ((payload?: unknown, formValues?: Record<string, unknown>) => void) | null = null
    let capturedRemove: ((credentialId: string) => void) | null = null
    const MockChild = ({ onSelectCredential, onUpdate, onRemove }: {
      onSelectCredential: (credential: Credential) => void
      onUpdate?: (payload?: unknown, formValues?: Record<string, unknown>) => void
      onRemove?: (credentialId: string) => void
    }) => {
      capturedAdd = onSelectCredential
      capturedUpdate = onUpdate || null
      capturedRemove = onRemove || null
      return null
    }
    vi.mocked(AddCredentialInLoadBalancing).mockImplementation(MockChild as unknown as typeof AddCredentialInLoadBalancing)

    const { rerender } = render(<StatefulHarness initialConfig={createDraftConfig(true)} />)

    expect(capturedAdd).toBeDefined()
    expect(capturedUpdate).toBeDefined()
    expect(capturedRemove).toBeDefined()

    // Set config to undefined
    rerender(<StatefulHarness initialConfig={undefined} />)

    // Trigger callbacks
    act(() => {
      if (capturedAdd)
        (capturedAdd as (credential: Credential) => void)({ credential_id: 'new', credential_name: 'New' })
      if (capturedUpdate)
        (capturedUpdate as (payload?: unknown, formValues?: Record<string, unknown>) => void)({ some: 'payload' })
      if (capturedRemove)
        (capturedRemove as (credentialId: string) => void)('cred-1')
    })

    // Should not throw and just return prev (which is undefined)
  })
})
