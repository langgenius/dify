import type {
  Credential,
  CustomModelCredential,
  ModelCredential,
  ModelLoadBalancingConfig,
  ModelProvider,
} from '../../declarations'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { ConfigurationMethodEnum } from '../../declarations'
import ModelLoadBalancingConfigs from '../model-load-balancing-configs'

let mockModelLoadBalancingEnabled = true
const render = (ui: React.ReactElement) =>
  renderWithConsoleQuery(ui, {
    systemFeatures: { deployment_edition: 'CLOUD' },
    features: { model_load_balancing_enabled: mockModelLoadBalancingEnabled },
  })

vi.mock('@/app/components/header/account-setting/model-provider-page/model-auth', () => ({
  AddCredentialInLoadBalancing: vi.fn(
    ({
      onSelectCredential,
      onUpdate,
      onRemove,
    }: {
      onSelectCredential: (credential: Credential) => void
      onUpdate?: (payload?: unknown, formValues?: Record<string, unknown>) => void
      onRemove?: (credentialId: string) => void
    }) => (
      <div>
        <button
          type="button"
          onClick={() =>
            onSelectCredential({ credential_id: 'cred-2', credential_name: 'Key 2' } as Credential)
          }
        >
          add credential
        </button>
        <button
          type="button"
          onClick={() =>
            onUpdate?.(
              { credential: { credential_id: 'cred-2' } },
              { __authorization_name__: 'Key 2' },
            )
          }
        >
          trigger update
        </button>
        <button type="button" onClick={() => onRemove?.('cred-2')}>
          trigger remove
        </button>
      </div>
    ),
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
      {
        credential_id: 'cred-enterprise',
        credential_name: 'Enterprise Key',
        from_enterprise: true,
      },
    ],
  } as unknown as ModelCredential

  const createDraftConfig = (enabled = true): ModelLoadBalancingConfig =>
    ({
      enabled,
      configs: [
        {
          id: 'cfg-1',
          credential_id: 'cred-1',
          enabled: true,
          name: 'Key 1',
        },
      ],
    }) as ModelLoadBalancingConfig

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
    const [draftConfig, setDraftConfig] = useState<ModelLoadBalancingConfig | undefined>(
      initialConfig,
    )
    return (
      <>
        <output aria-label="Draft load balancing configuration">
          {JSON.stringify(draftConfig)}
        </output>
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
      </>
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockModelLoadBalancingEnabled = true
  })

  afterEach(() => vi.useRealTimers())

  const readDraft = (): ModelLoadBalancingConfig =>
    JSON.parse(screen.getByLabelText('Draft load balancing configuration').textContent!)

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

  it('should enable load balancing from the named mode button with the keyboard', async () => {
    const user = userEvent.setup()
    render(<StatefulHarness initialConfig={createDraftConfig(false)} withSwitch={false} />)

    const modeButton = screen.getByTestId('load-balancing-select-mode')
    expect(modeButton).toHaveAccessibleName('modelProvider.modelProvider.loadBalancing')
    modeButton.focus()
    await user.keyboard('[Space]')
    expect(screen.getByText('Key 1')).toBeInTheDocument()
  })

  it('should handle removing an entry via the UI button', async () => {
    const user = userEvent.setup()
    render(<StatefulHarness initialConfig={createDraftConfig(true)} />)

    const removeBtn = screen.getByRole('button', { name: 'common.operation.remove Key 1' })
    removeBtn.focus()
    await user.keyboard('{Enter}')

    expect(screen.queryByText('Key 1')).not.toBeInTheDocument()
  })

  it('should toggle individual entry enabled state', async () => {
    const user = userEvent.setup()
    render(<StatefulHarness initialConfig={createDraftConfig(true)} />)

    const entrySwitch = screen.getByTestId('load-balancing-switch-cfg-1')
    expect(screen.getByRole('switch', { name: 'Key 1' })).toBe(entrySwitch)
    await user.click(entrySwitch)
    expect(entrySwitch).toHaveAttribute('aria-checked', 'false')
    expect(readDraft().configs[0]).toMatchObject({ credential_id: 'cred-1', enabled: false })
    await user.click(entrySwitch)
    expect(entrySwitch).toHaveAttribute('aria-checked', 'true')
    expect(readDraft().configs[0]).toMatchObject({ credential_id: 'cred-1', enabled: true })
  })

  it('should toggle load balancing via main switch', async () => {
    const user = userEvent.setup()
    render(<StatefulHarness initialConfig={createDraftConfig(true)} withSwitch />)

    const mainSwitch = screen.getByTestId('load-balancing-switch-main')
    expect(screen.getByRole('switch', { name: 'modelProvider.modelProvider.loadBalancing' })).toBe(
      mainSwitch,
    )
    await user.click(mainSwitch)
    expect(mainSwitch).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByRole('switch', { name: 'Key 1' })).not.toBeInTheDocument()
    expect(readDraft()).toEqual(createDraftConfig(false))
    expect(
      screen.getByText('modelProvider.modelProvider.loadBalancingDescription'),
    ).toBeInTheDocument()
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

  it('should clear cooldown metadata only after the actual timer expires', async () => {
    vi.useFakeTimers()
    const cooldownConfig: ModelLoadBalancingConfig = {
      enabled: true,
      configs: [
        {
          id: 'cfg-1',
          credential_id: 'cred-1',
          enabled: true,
          name: 'Key 1',
          in_cooldown: true,
          ttl: 30,
        },
      ],
    } as unknown as ModelLoadBalancingConfig
    render(<StatefulHarness initialConfig={cooldownConfig} />)

    await act(async () => vi.advanceTimersByTimeAsync(29_000))
    expect(readDraft().configs[0]).toMatchObject({ in_cooldown: true, ttl: 30 })
    await act(async () => vi.advanceTimersByTimeAsync(1000))
    expect(readDraft().configs[0]).toEqual({
      id: 'cfg-1',
      credential_id: 'cred-1',
      enabled: true,
      name: 'Key 1',
      in_cooldown: false,
    })
  })

  it('should handle child component callbacks: add, update, remove', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()
    const onRemove = vi.fn()
    render(
      <StatefulHarness
        initialConfig={createDraftConfig(true)}
        onUpdate={onUpdate}
        onRemove={onRemove}
      />,
    )

    expect(screen.getByText(/loadBalancingLeastKeyWarning/)).toBeInTheDocument()
    // Add
    await user.click(screen.getByRole('button', { name: 'add credential' }))
    expect(screen.getByText('Key 2')).toBeInTheDocument()
    expect(screen.queryByText(/loadBalancingLeastKeyWarning/)).not.toBeInTheDocument()
    expect(readDraft().configs).toEqual([
      ...createDraftConfig().configs,
      { credential_id: 'cred-2', enabled: true, name: 'Key 2' },
    ])

    // Update
    await user.click(screen.getByRole('button', { name: 'trigger update' }))
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith(
      { credential: { credential_id: 'cred-2' } },
      { __authorization_name__: 'Key 2' },
    )

    // Remove
    await user.click(screen.getByRole('button', { name: 'trigger remove' }))
    expect(onRemove).toHaveBeenCalledWith('cred-2')
    expect(screen.queryByText('Key 2')).not.toBeInTheDocument()
    expect(screen.getByText('Key 1')).toBeInTheDocument()
  })

  it('should show "Provider Managed" badge for inherit config in predefined method', () => {
    const inheritConfig: ModelLoadBalancingConfig = {
      enabled: true,
      configs: [{ id: 'cfg-inherit', credential_id: '', enabled: true, name: '__inherit__' }],
    } as ModelLoadBalancingConfig
    render(
      <StatefulHarness
        initialConfig={inheritConfig}
        configurationMethod={ConfigurationMethodEnum.predefinedModel}
      />,
    )

    expect(screen.getByText('modelProvider.modelProvider.providerManaged')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /common.operation.remove/ }),
    ).not.toBeInTheDocument()
    expect(screen.getByText('modelProvider.modelProvider.defaultConfig')).toBeInTheDocument()
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
    expect(screen.getByText('Key 1')).toBeInTheDocument()
  })

  it('should toggle load balancing to false when modelLoadBalancingEnabled=false but enabled=true via switch', async () => {
    const user = userEvent.setup()
    mockModelLoadBalancingEnabled = false
    render(<StatefulHarness initialConfig={createDraftConfig(true)} withSwitch />)

    const mainSwitch = screen.getByTestId('load-balancing-switch-main')
    await user.click(mainSwitch)

    expect(mainSwitch).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByText('Key 1')).not.toBeInTheDocument()
  })

  it('should not show provider badge when isProviderManaged=true but configurationMethod is customizableModel', () => {
    const inheritConfig: ModelLoadBalancingConfig = {
      enabled: true,
      configs: [{ id: 'cfg-inherit', credential_id: '', enabled: true, name: '__inherit__' }],
    } as ModelLoadBalancingConfig

    render(
      <StatefulHarness
        initialConfig={inheritConfig}
        configurationMethod={ConfigurationMethodEnum.customizableModel}
      />,
    )

    expect(screen.getByText('modelProvider.modelProvider.defaultConfig')).toBeInTheDocument()
    expect(
      screen.queryByText('modelProvider.modelProvider.providerManaged'),
    ).not.toBeInTheDocument()
  })

  it('should show upgrade panel when modelLoadBalancingEnabled=false and not CE edition', () => {
    mockModelLoadBalancingEnabled = false

    render(<StatefulHarness initialConfig={createDraftConfig(false)} />)

    expect(screen.getByText('upgrade')).toBeInTheDocument()
    expect(
      screen.getByText('modelProvider.modelProvider.upgradeForLoadBalancing'),
    ).toBeInTheDocument()
  })

  it('should prevent enabling a restricted credential', async () => {
    const setDraftConfig = vi.fn()
    const restrictedConfig: ModelLoadBalancingConfig = {
      enabled: true,
      configs: [
        {
          id: 'cfg-restricted',
          credential_id: 'cred-restricted',
          enabled: true,
          name: 'Restricted Key',
        },
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
        setDraftConfig={setDraftConfig}
        provider={mockProvider}
        configurationMethod={ConfigurationMethodEnum.predefinedModel}
        modelCredential={mockModelCredentialWithRestricted}
        model={{ model: 'gpt-4', model_type: 'llm' } as CustomModelCredential}
      />,
    )

    const entrySwitch = screen.getByTestId('load-balancing-switch-cfg-restricted')
    expect(entrySwitch).toHaveAttribute('aria-disabled', 'true')
    await userEvent.setup().click(entrySwitch)
    expect(entrySwitch).toHaveAttribute('aria-checked', 'false')
    expect(setDraftConfig).not.toHaveBeenCalled()
  })

  it('should not toggle load balancing when modelLoadBalancingEnabled=false and clicking panel to enable', async () => {
    mockModelLoadBalancingEnabled = false
    render(<StatefulHarness initialConfig={createDraftConfig(false)} withSwitch={false} />)

    expect(screen.queryByTestId('load-balancing-select-mode')).not.toBeInTheDocument()

    expect(screen.queryByText('Key 1')).not.toBeInTheDocument()
  })
})
