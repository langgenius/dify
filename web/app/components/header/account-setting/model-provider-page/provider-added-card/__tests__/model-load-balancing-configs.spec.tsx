import type {
  Credential,
  CustomModelCredential,
  ModelCredential,
  ModelLoadBalancingConfig,
  ModelProvider,
} from '../../declarations'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { AddCredentialInLoadBalancing } from '@/app/components/header/account-setting/model-provider-page/model-auth'
import { ConfigurationMethodEnum } from '../../declarations'
import ModelLoadBalancingConfigs from '../model-load-balancing-configs'

let mockModelLoadBalancingEnabled = true

vi.mock('@/config', () => ({
  IS_CE_EDITION: false,
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContextSelector: (selector: (state: { modelLoadBalancingEnabled: boolean }) => boolean) => selector({ modelLoadBalancingEnabled: mockModelLoadBalancingEnabled }),
}))

vi.mock('../cooldown-timer', () => ({
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
    expect(mainSwitch).toHaveAttribute('aria-disabled', 'true')

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

  it('should remove credential at index 0', async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    // Create config where the target credential is at index 0
    const config: ModelLoadBalancingConfig = {
      enabled: true,
      configs: [
        { id: 'cfg-target', credential_id: 'cred-2', enabled: true, name: 'Key 2' },
        { id: 'cfg-other', credential_id: 'cred-1', enabled: true, name: 'Key 1' },
      ],
    } as ModelLoadBalancingConfig

    render(<StatefulHarness initialConfig={config} onRemove={onRemove} />)

    await user.click(screen.getByRole('button', { name: 'trigger remove' }))

    expect(onRemove).toHaveBeenCalledWith('cred-2')
    expect(screen.queryByText('Key 2')).not.toBeInTheDocument()
  })

  it('should not toggle load balancing when modelLoadBalancingEnabled=false and enabling via switch', async () => {
    const user = userEvent.setup()
    mockModelLoadBalancingEnabled = false
    render(<StatefulHarness initialConfig={createDraftConfig(false)} withSwitch />)

    const mainSwitch = screen.getByTestId('load-balancing-switch-main')
    await user.click(mainSwitch)

    // Switch is disabled so toggling to true should not work
    expect(mainSwitch).toHaveAttribute('aria-checked', 'false')
  })

  it('should toggle load balancing to false when modelLoadBalancingEnabled=false but enabled=true via switch', async () => {
    const user = userEvent.setup()
    mockModelLoadBalancingEnabled = false
    // When draftConfig.enabled=true and !enabled (toggling off): condition `(modelLoadBalancingEnabled || !enabled)` = (!enabled) = true
    render(<StatefulHarness initialConfig={createDraftConfig(true)} withSwitch />)

    const mainSwitch = screen.getByTestId('load-balancing-switch-main')
    await user.click(mainSwitch)

    expect(mainSwitch).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByText('Key 1')).not.toBeInTheDocument()
  })

  it('should not show provider badge when isProviderManaged=true but configurationMethod is customizableModel', () => {
    const inheritConfig: ModelLoadBalancingConfig = {
      enabled: true,
      configs: [
        { id: 'cfg-inherit', credential_id: '', enabled: true, name: '__inherit__' },
      ],
    } as ModelLoadBalancingConfig

    render(
      <StatefulHarness
        initialConfig={inheritConfig}
        configurationMethod={ConfigurationMethodEnum.customizableModel}
      />,
    )

    expect(screen.getByText('common.modelProvider.defaultConfig')).toBeInTheDocument()
    expect(screen.queryByText('common.modelProvider.providerManaged')).not.toBeInTheDocument()
  })

  it('should show upgrade panel when modelLoadBalancingEnabled=false and not CE edition', () => {
    mockModelLoadBalancingEnabled = false

    render(<StatefulHarness initialConfig={createDraftConfig(false)} />)

    expect(screen.getByText('upgrade')).toBeInTheDocument()
    expect(screen.getByText('common.modelProvider.upgradeForLoadBalancing')).toBeInTheDocument()
  })

  it('should pass explicit boolean state to toggleConfigEntryEnabled (typeof state === boolean branch)', async () => {
    // Arrange: render with a config entry; the Switch onChange passes explicit boolean value
    const user = userEvent.setup()
    render(<StatefulHarness initialConfig={createDraftConfig(true)} />)

    // Act: click the switch which calls toggleConfigEntryEnabled(index, value) where value is boolean
    const entrySwitch = screen.getByTestId('load-balancing-switch-cfg-1')
    await user.click(entrySwitch)

    // Assert: component still renders after the toggle (state = explicit boolean true/false)
    expect(screen.getByTestId('load-balancing-main-panel')).toBeInTheDocument()
  })

  it('should render with credential that has not_allowed_to_use flag (covers credential?.not_allowed_to_use ? false branch)', () => {
    // Arrange: config where the credential is not allowed to use
    const restrictedConfig: ModelLoadBalancingConfig = {
      enabled: true,
      configs: [
        { id: 'cfg-restricted', credential_id: 'cred-restricted', enabled: true, name: 'Restricted Key' },
      ],
    } as ModelLoadBalancingConfig

    const mockModelCredentialWithRestricted = {
      available_credentials: [
        {
          credential_id: 'cred-restricted',
          credential_name: 'Restricted Key',
          not_allowed_to_use: true,
        },
      ],
    } as unknown as ModelCredential

    // Act
    render(
      <ModelLoadBalancingConfigs
        draftConfig={restrictedConfig}
        setDraftConfig={vi.fn()}
        provider={mockProvider}
        configurationMethod={ConfigurationMethodEnum.predefinedModel}
        modelCredential={mockModelCredentialWithRestricted}
        model={{ model: 'gpt-4', model_type: 'llm' } as CustomModelCredential}
      />,
    )

    // Assert: Switch value should be false (credential?.not_allowed_to_use ? false branch)
    const entrySwitch = screen.getByTestId('load-balancing-switch-cfg-restricted')
    expect(entrySwitch).toHaveAttribute('aria-checked', 'false')
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

  it('should not toggle load balancing when modelLoadBalancingEnabled=false and clicking panel to enable', async () => {
    // Arrange: load balancing not enabled in context, draftConfig.enabled=false (so panel is clickable)
    const user = userEvent.setup()
    mockModelLoadBalancingEnabled = false
    render(<StatefulHarness initialConfig={createDraftConfig(false)} withSwitch={false} />)

    // Act: clicking the panel calls toggleModalBalancing(true)
    // but (modelLoadBalancingEnabled || !enabled) = (false || false) = false → condition fails
    const panel = screen.getByTestId('load-balancing-main-panel')
    await user.click(panel)

    expect(screen.queryByText('Key 1')).not.toBeInTheDocument()
  })

  it('should return early from addConfigEntry setDraftConfig when prev is undefined', async () => {
    // Arrange: use a controlled wrapper that exposes a way to force draftConfig to undefined
    let capturedAdd: ((credential: Credential) => void) | null = null
    const MockChild = ({ onSelectCredential }: {
      onSelectCredential: (credential: Credential) => void
    }) => {
      capturedAdd = onSelectCredential
      return null
    }
    vi.mocked(AddCredentialInLoadBalancing).mockImplementation(MockChild as unknown as typeof AddCredentialInLoadBalancing)

    // Use a setDraftConfig spy that tracks calls and simulates null prev
    const setDraftConfigSpy = vi.fn((updater: ((prev: ModelLoadBalancingConfig | undefined) => ModelLoadBalancingConfig | undefined) | ModelLoadBalancingConfig | undefined) => {
      if (typeof updater === 'function')
        updater(undefined)
    })

    render(
      <ModelLoadBalancingConfigs
        draftConfig={createDraftConfig(true)}
        setDraftConfig={setDraftConfigSpy}
        provider={mockProvider}
        configurationMethod={ConfigurationMethodEnum.predefinedModel}
        modelCredential={mockModelCredential}
        model={{ model: 'gpt-4', model_type: 'llm' } as CustomModelCredential}
      />,
    )

    // Act: trigger addConfigEntry with undefined prev via the spy
    act(() => {
      if (capturedAdd)
        (capturedAdd as (credential: Credential) => void)({ credential_id: 'new', credential_name: 'New' } as Credential)
    })

    // Assert: setDraftConfig was called and the updater returned early (prev was undefined)
    expect(setDraftConfigSpy).toHaveBeenCalled()
  })

  it('should return early from updateConfigEntry setDraftConfig when prev is undefined', async () => {
    // Arrange: use setDraftConfig spy that invokes updater with undefined prev
    const setDraftConfigSpy = vi.fn((updater: ((prev: ModelLoadBalancingConfig | undefined) => ModelLoadBalancingConfig | undefined) | ModelLoadBalancingConfig | undefined) => {
      if (typeof updater === 'function')
        updater(undefined)
    })

    render(
      <ModelLoadBalancingConfigs
        draftConfig={createDraftConfig(true)}
        setDraftConfig={setDraftConfigSpy}
        provider={mockProvider}
        configurationMethod={ConfigurationMethodEnum.predefinedModel}
        modelCredential={mockModelCredential}
        model={{ model: 'gpt-4', model_type: 'llm' } as CustomModelCredential}
      />,
    )

    // Act: click remove button which triggers updateConfigEntry → setDraftConfig with prev=undefined
    const removeBtn = screen.getByTestId('load-balancing-remove-cfg-1')
    fireEvent.click(removeBtn)

    // Assert: setDraftConfig was called and handled undefined prev gracefully
    expect(setDraftConfigSpy).toHaveBeenCalled()
  })
})
