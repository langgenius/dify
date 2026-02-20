import type {
  Credential,
  CustomModelCredential,
  ModelCredential,
  ModelLoadBalancingConfig,
  ModelProvider,
} from '../declarations'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { ConfigurationMethodEnum } from '../declarations'
import ModelLoadBalancingConfigs from './model-load-balancing-configs'

let mockModelLoadBalancingEnabled = true

vi.mock('@/config', () => ({
  IS_CE_EDITION: false,
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContextSelector: () => mockModelLoadBalancingEnabled,
}))

vi.mock('./cooldown-timer', () => ({
  default: ({ secondsRemaining, onFinish }: { secondsRemaining?: number, onFinish?: () => void }) => (
    <button type="button" onClick={onFinish}>
      {secondsRemaining}
      s
    </button>
  ),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-auth', () => ({
  AddCredentialInLoadBalancing: ({ onSelectCredential, onUpdate, onRemove }: {
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
  ),
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
  }: {
    initialConfig: ModelLoadBalancingConfig
    withSwitch?: boolean
    onUpdate?: (payload?: unknown, formValues?: Record<string, unknown>) => void
    onRemove?: (credentialId: string) => void
  }) => {
    const [draftConfig, setDraftConfig] = useState<ModelLoadBalancingConfig | undefined>(initialConfig)
    return (
      <ModelLoadBalancingConfigs
        draftConfig={draftConfig}
        setDraftConfig={setDraftConfig}
        provider={mockProvider}
        configurationMethod={ConfigurationMethodEnum.predefinedModel}
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

  it('should show current configs and low key warning when enabled', () => {
    render(<StatefulHarness initialConfig={createDraftConfig(true)} />)

    expect(screen.getAllByText(/modelProvider\.loadBalancing/).length).toBeGreaterThan(0)
    expect(screen.getByText('Key 1')).toBeInTheDocument()
    expect(screen.getByText(/modelProvider\.loadBalancingLeastKeyWarning/)).toBeInTheDocument()
  })

  it('should enable load balancing by clicking the panel when disabled', () => {
    render(<StatefulHarness initialConfig={createDraftConfig(false)} />)

    fireEvent.click(screen.getAllByText(/modelProvider\.loadBalancing/)[0])

    expect(screen.getByText('Key 1')).toBeInTheDocument()
  })

  it('should add and remove credentials from the visible list', () => {
    const onUpdate = vi.fn()
    const onRemove = vi.fn()
    const draftConfig = {
      enabled: true,
      configs: [
        { id: 'cfg-1', credential_id: 'cred-1', enabled: true, name: 'Key 1', in_cooldown: true, ttl: 30 },
        { id: 'cfg-2', credential_id: 'cred-2', enabled: true, name: '__inherit__' },
      ],
    } as unknown as ModelLoadBalancingConfig
    render(<StatefulHarness initialConfig={draftConfig} withSwitch onUpdate={onUpdate} onRemove={onRemove} />)

    fireEvent.click(screen.getByRole('button', { name: '30s' }))

    fireEvent.click(screen.getByRole('button', { name: 'add credential' }))
    expect(screen.getByText('Key 2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'trigger update' }))
    expect(onUpdate).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'trigger remove' }))
    expect(onRemove).toHaveBeenCalledWith('cred-2')
    expect(screen.queryByText('Key 2')).not.toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('switch')[0])
  })

  it('should show upgrade prompt when feature is unavailable', () => {
    mockModelLoadBalancingEnabled = false
    render(<StatefulHarness initialConfig={createDraftConfig(true)} withSwitch />)

    expect(screen.getByText(/modelProvider\.upgradeForLoadBalancing/)).toBeInTheDocument()
    expect(screen.getByText('upgrade')).toBeInTheDocument()
  })
})
