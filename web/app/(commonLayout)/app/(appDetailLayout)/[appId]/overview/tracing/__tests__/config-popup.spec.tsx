import type { PopupProps } from '../config-popup'
import { fireEvent, render, screen } from '@testing-library/react'
import ConfigPopup from '../config-popup'
import { TracingProvider } from '../type'

vi.mock('@/app/components/base/divider', () => ({
  default: () => <div data-testid="divider" />,
}))

vi.mock('@/app/components/base/switch', () => ({
  default: ({
    value,
    onChange,
    disabled,
  }: {
    value: boolean
    onChange: (value: boolean) => void
    disabled?: boolean
  }) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => !disabled && onChange(!value)}
    >
      {`switch:${value ? 'on' : 'off'}:${disabled ? 'disabled' : 'enabled'}`}
    </button>
  ),
}))

vi.mock('@/app/components/base/tooltip', () => ({
  default: ({
    popupContent,
    children,
  }: {
    popupContent: React.ReactNode
    children: React.ReactNode
  }) => (
    <div>
      <div>{popupContent}</div>
      {children}
    </div>
  ),
}))

vi.mock('@/app/components/header/indicator', () => ({
  default: ({ color }: { color: string }) => <div>{`indicator:${color}`}</div>,
}))

vi.mock('../tracing-icon', () => ({
  default: ({ size }: { size: string }) => <div>{`tracing-icon:${size}`}</div>,
}))

vi.mock('../provider-panel', () => ({
  default: ({
    type,
    hasConfigured,
    onConfig,
    onChoose,
  }: {
    type: TracingProvider
    hasConfigured: boolean
    onConfig: () => void
    onChoose: () => void
  }) => (
    <div>
      <div>{`provider-panel:${type}:${hasConfigured ? 'configured' : 'empty'}`}</div>
      <button type="button" onClick={onConfig}>{`config:${type}`}</button>
      <button type="button" onClick={onChoose}>{`choose:${type}`}</button>
    </div>
  ),
}))

vi.mock('../provider-config-modal', () => ({
  default: ({
    type,
    onSaved,
    onRemoved,
    onCancel,
  }: {
    type: TracingProvider
    onSaved: (payload: Record<string, string>) => void
    onRemoved: () => void
    onCancel: () => void
  }) => (
    <div>
      <div>{`provider-config-modal:${type}`}</div>
      <button type="button" onClick={() => onSaved({ saved: type })}>save-config-modal</button>
      <button type="button" onClick={onRemoved}>remove-config-modal</button>
      <button type="button" onClick={onCancel}>cancel-config-modal</button>
    </div>
  ),
}))

const createProps = (overrides: Partial<PopupProps> = {}): PopupProps => ({
  appId: 'app-1',
  readOnly: false,
  enabled: false,
  onStatusChange: vi.fn(),
  chosenProvider: null,
  onChooseProvider: vi.fn(),
  arizeConfig: null,
  phoenixConfig: null,
  langSmithConfig: null,
  langFuseConfig: null,
  opikConfig: null,
  weaveConfig: null,
  aliyunConfig: null,
  mlflowConfig: null,
  databricksConfig: null,
  tencentConfig: null,
  onConfigUpdated: vi.fn(),
  onConfigRemoved: vi.fn(),
  ...overrides,
})

describe('OverviewRouteConfigPopup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render all providers in the not-configured state and disable the switch', () => {
    render(<ConfigPopup {...createProps()} />)

    expect(screen.getByText('app.tracing.configProviderTitle.notConfigured')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'switch:off:disabled' })).toBeDisabled()
    expect(screen.getByText('provider-panel:langfuse:empty')).toBeInTheDocument()
    expect(screen.getByText('provider-panel:tencent:empty')).toBeInTheDocument()
  })

  it('should render configured and more-provider sections when configs are mixed', () => {
    const onChooseProvider = vi.fn()
    const onConfigUpdated = vi.fn()
    const onConfigRemoved = vi.fn()

    render(
      <ConfigPopup
        {...createProps({
          enabled: true,
          chosenProvider: TracingProvider.langfuse,
          onChooseProvider,
          onConfigUpdated,
          onConfigRemoved,
          langFuseConfig: { secret_key: 'secret', public_key: 'public', host: 'https://langfuse.example' },
          opikConfig: { api_key: 'opik-key', project: 'opik-project', workspace: 'default', url: 'https://opik.example' },
        })}
      />,
    )

    expect(screen.getByText('app.tracing.configProviderTitle.configured')).toBeInTheDocument()
    expect(screen.getByText('app.tracing.configProviderTitle.moreProvider')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'switch:on:enabled' }))
    fireEvent.click(screen.getByRole('button', { name: 'choose:opik' }))
    fireEvent.click(screen.getByRole('button', { name: 'config:langfuse' }))

    expect(onChooseProvider).toHaveBeenCalledWith(TracingProvider.opik)
    expect(screen.getByText('provider-config-modal:langfuse')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'save-config-modal' }))
    expect(onConfigUpdated).toHaveBeenCalledWith(TracingProvider.langfuse, { saved: TracingProvider.langfuse })

    fireEvent.click(screen.getByRole('button', { name: 'config:langfuse' }))
    fireEvent.click(screen.getByRole('button', { name: 'remove-config-modal' }))
    expect(onConfigRemoved).toHaveBeenCalledWith(TracingProvider.langfuse)
  })

  it('should render the configured-only section when every provider already has a config', () => {
    const configured = { api_key: 'value', project: 'project', endpoint: '' }

    render(
      <ConfigPopup
        {...createProps({
          enabled: true,
          arizeConfig: { api_key: 'k', space_id: 's', project: 'p', endpoint: '' },
          phoenixConfig: configured,
          langSmithConfig: configured,
          langFuseConfig: { secret_key: 's', public_key: 'p', host: 'https://langfuse.example' },
          opikConfig: { api_key: 'k', project: 'p', workspace: '', url: '' },
          weaveConfig: { api_key: 'k', entity: '', project: 'p', endpoint: '', host: '' },
          aliyunConfig: { app_name: 'app', license_key: 'license', endpoint: '' },
          mlflowConfig: { tracking_uri: 'uri', experiment_id: 'exp', username: '', password: '' },
          databricksConfig: { experiment_id: 'exp', host: 'host', client_id: '', client_secret: '', personal_access_token: '' },
          tencentConfig: { token: 'token', endpoint: 'endpoint', service_name: 'service' },
        })}
      />,
    )

    expect(screen.getByText('app.tracing.configProviderTitle.configured')).toBeInTheDocument()
    expect(screen.queryByText('app.tracing.configProviderTitle.moreProvider')).not.toBeInTheDocument()
    expect(screen.getByText('provider-panel:langfuse:configured')).toBeInTheDocument()
    expect(screen.getByText('provider-panel:tencent:configured')).toBeInTheDocument()
  })

  it('should resolve provider payloads for every config button in mixed mode', () => {
    render(
      <ConfigPopup
        {...createProps({
          arizeConfig: { api_key: 'k', space_id: 's', project: 'p', endpoint: '' },
          phoenixConfig: { api_key: 'k', project: 'p', endpoint: '' },
          langSmithConfig: null,
          langFuseConfig: null,
          opikConfig: null,
          weaveConfig: { api_key: 'k', entity: '', project: 'p', endpoint: '', host: '' },
          aliyunConfig: { app_name: 'app', license_key: 'license', endpoint: '' },
          mlflowConfig: { tracking_uri: 'uri', experiment_id: 'exp', username: '', password: '' },
          databricksConfig: { experiment_id: 'exp', host: 'host', client_id: '', client_secret: '', personal_access_token: '' },
          tencentConfig: { token: 'token', endpoint: 'endpoint', service_name: 'service' },
        })}
      />,
    )

    const providers = [
      TracingProvider.arize,
      TracingProvider.phoenix,
      TracingProvider.langSmith,
      TracingProvider.langfuse,
      TracingProvider.opik,
      TracingProvider.weave,
      TracingProvider.aliyun,
      TracingProvider.mlflow,
      TracingProvider.databricks,
      TracingProvider.tencent,
    ]

    providers.forEach((provider) => {
      fireEvent.click(screen.getByRole('button', { name: `config:${provider}` }))
      expect(screen.getByText(`provider-config-modal:${provider}`)).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'cancel-config-modal' }))
    })
  })
})
