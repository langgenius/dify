import type { LangSmithConfig, WeaveConfig } from '../type'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ProviderConfigModal from '../provider-config-modal'
import { TracingProvider } from '../type'

const mockToast = vi.fn()
const mockAddTracingConfig = vi.fn()
const mockUpdateTracingConfig = vi.fn()
const mockRemoveTracingConfig = vi.fn()

vi.mock('@/app/components/base/button', () => ({
  default: ({ children, onClick }: { children: React.ReactNode, onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
}))

vi.mock('@/app/components/base/confirm', () => ({
  default: ({
    title,
    content,
    onConfirm,
    onCancel,
  }: {
    title: string
    content: string
    onConfirm: () => void
    onCancel: () => void
  }) => (
    <div>
      <div>{title}</div>
      <div>{content}</div>
      <button type="button" onClick={onConfirm}>confirm-remove</button>
      <button type="button" onClick={onCancel}>cancel-remove</button>
    </div>
  ),
}))

vi.mock('@/app/components/base/divider', () => ({
  default: () => <div data-testid="divider" />,
}))

vi.mock('@/app/components/base/portal-to-follow-elem', () => ({
  PortalToFollowElem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PortalToFollowElemContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/app/components/base/icons/src/vender/line/general', () => ({
  LinkExternal02: () => <span>external-link-icon</span>,
}))

vi.mock('@/app/components/base/icons/src/vender/solid/security', () => ({
  Lock01: () => <span>lock-icon</span>,
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}))

vi.mock('@/service/apps', () => ({
  addTracingConfig: (...args: unknown[]) => mockAddTracingConfig(...args),
  updateTracingConfig: (...args: unknown[]) => mockUpdateTracingConfig(...args),
  removeTracingConfig: (...args: unknown[]) => mockRemoveTracingConfig(...args),
}))

vi.mock('../field', () => ({
  default: ({
    label,
    value,
    onChange,
  }: {
    label: string
    value: string
    onChange: (value: string) => void
  }) => (
    <label>
      {label}
      <input
        aria-label={label}
        value={value}
        onChange={event => onChange(event.target.value)}
      />
    </label>
  ),
}))

type SaveCase = {
  provider: TracingProvider
  fields: Array<{ label: string, value: string }>
  expected: Record<string, string>
}

const saveCases: SaveCase[] = [
  {
    provider: TracingProvider.arize,
    fields: [
      { label: 'API Key', value: 'arize-key' },
      { label: 'Space ID', value: 'space-1' },
      { label: 'app.tracing.configProvider.project', value: 'arize-project' },
      { label: 'Endpoint', value: 'https://arize.example' },
    ],
    expected: { api_key: 'arize-key', space_id: 'space-1', project: 'arize-project', endpoint: 'https://arize.example' },
  },
  {
    provider: TracingProvider.phoenix,
    fields: [
      { label: 'API Key', value: 'phoenix-key' },
      { label: 'app.tracing.configProvider.project', value: 'phoenix-project' },
      { label: 'Endpoint', value: 'https://phoenix.example' },
    ],
    expected: { api_key: 'phoenix-key', project: 'phoenix-project', endpoint: 'https://phoenix.example' },
  },
  {
    provider: TracingProvider.langSmith,
    fields: [
      { label: 'API Key', value: 'smith-key' },
      { label: 'app.tracing.configProvider.project', value: 'smith-project' },
      { label: 'Endpoint', value: 'https://smith.example' },
    ],
    expected: { api_key: 'smith-key', project: 'smith-project', endpoint: 'https://smith.example' },
  },
  {
    provider: TracingProvider.langfuse,
    fields: [
      { label: 'app.tracing.configProvider.secretKey', value: 'secret' },
      { label: 'app.tracing.configProvider.publicKey', value: 'public' },
      { label: 'Host', value: 'https://langfuse.example' },
    ],
    expected: { secret_key: 'secret', public_key: 'public', host: 'https://langfuse.example' },
  },
  {
    provider: TracingProvider.opik,
    fields: [
      { label: 'API Key', value: 'opik-key' },
      { label: 'app.tracing.configProvider.project', value: 'opik-project' },
      { label: 'Workspace', value: 'workspace-1' },
      { label: 'Url', value: 'https://opik.example' },
    ],
    expected: { api_key: 'opik-key', project: 'opik-project', workspace: 'workspace-1', url: 'https://opik.example' },
  },
  {
    provider: TracingProvider.weave,
    fields: [
      { label: 'API Key', value: 'weave-key' },
      { label: 'app.tracing.configProvider.project', value: 'weave-project' },
      { label: 'Entity', value: 'entity-1' },
      { label: 'Endpoint', value: 'https://weave-endpoint.example' },
      { label: 'Host', value: 'https://weave-host.example' },
    ],
    expected: { api_key: 'weave-key', project: 'weave-project', entity: 'entity-1', endpoint: 'https://weave-endpoint.example', host: 'https://weave-host.example' },
  },
  {
    provider: TracingProvider.aliyun,
    fields: [
      { label: 'License Key', value: 'license-1' },
      { label: 'Endpoint', value: 'https://aliyun.example' },
      { label: 'App Name', value: 'aliyun-app' },
    ],
    expected: { license_key: 'license-1', endpoint: 'https://aliyun.example', app_name: 'aliyun-app' },
  },
  {
    provider: TracingProvider.mlflow,
    fields: [
      { label: 'app.tracing.configProvider.trackingUri', value: 'http://mlflow.local' },
      { label: 'app.tracing.configProvider.experimentId', value: 'exp-1' },
      { label: 'app.tracing.configProvider.username', value: 'ml-user' },
      { label: 'app.tracing.configProvider.password', value: 'ml-pass' },
    ],
    expected: { tracking_uri: 'http://mlflow.local', experiment_id: 'exp-1', username: 'ml-user', password: 'ml-pass' },
  },
  {
    provider: TracingProvider.databricks,
    fields: [
      { label: 'app.tracing.configProvider.experimentId', value: 'db-exp' },
      { label: 'app.tracing.configProvider.databricksHost', value: 'https://databricks.example' },
      { label: 'app.tracing.configProvider.clientId', value: 'client-id' },
      { label: 'app.tracing.configProvider.clientSecret', value: 'client-secret' },
      { label: 'app.tracing.configProvider.personalAccessToken', value: 'token-1' },
    ],
    expected: { experiment_id: 'db-exp', host: 'https://databricks.example', client_id: 'client-id', client_secret: 'client-secret', personal_access_token: 'token-1' },
  },
  {
    provider: TracingProvider.tencent,
    fields: [
      { label: 'Token', value: 'token-1' },
      { label: 'Endpoint', value: 'https://tencent.example' },
      { label: 'Service Name', value: 'svc-1' },
    ],
    expected: { token: 'token-1', endpoint: 'https://tencent.example', service_name: 'svc-1' },
  },
]

const fillFields = (fields: SaveCase['fields']) => {
  fields.forEach(({ label, value }) => {
    fireEvent.change(screen.getByLabelText(label), { target: { value } })
  })
}

type InvalidCase = {
  provider: TracingProvider
  fields?: Array<{ label: string, value: string }>
}

const invalidCases: InvalidCase[] = [
  { provider: TracingProvider.arize },
  { provider: TracingProvider.arize, fields: [{ label: 'API Key', value: 'api-key' }] },
  { provider: TracingProvider.arize, fields: [{ label: 'API Key', value: 'api-key' }, { label: 'Space ID', value: 'space-id' }] },
  { provider: TracingProvider.phoenix },
  { provider: TracingProvider.phoenix, fields: [{ label: 'API Key', value: 'api-key' }] },
  { provider: TracingProvider.langSmith },
  { provider: TracingProvider.langSmith, fields: [{ label: 'API Key', value: 'api-key' }] },
  { provider: TracingProvider.langfuse, fields: [{ label: 'app.tracing.configProvider.secretKey', value: 'secret' }] },
  { provider: TracingProvider.langfuse, fields: [{ label: 'app.tracing.configProvider.secretKey', value: 'secret' }, { label: 'app.tracing.configProvider.publicKey', value: 'public' }] },
  { provider: TracingProvider.weave },
  { provider: TracingProvider.weave, fields: [{ label: 'API Key', value: 'api-key' }] },
  { provider: TracingProvider.aliyun },
  { provider: TracingProvider.aliyun, fields: [{ label: 'App Name', value: 'aliyun-app' }] },
  { provider: TracingProvider.aliyun, fields: [{ label: 'App Name', value: 'aliyun-app' }, { label: 'License Key', value: 'license' }] },
  { provider: TracingProvider.mlflow },
  { provider: TracingProvider.databricks },
  { provider: TracingProvider.databricks, fields: [{ label: 'app.tracing.configProvider.experimentId', value: 'exp-id' }] },
  { provider: TracingProvider.tencent },
  { provider: TracingProvider.tencent, fields: [{ label: 'Token', value: 'token' }] },
  { provider: TracingProvider.tencent, fields: [{ label: 'Token', value: 'token' }, { label: 'Endpoint', value: 'https://tencent.example' }] },
]

describe('OverviewRouteProviderConfigModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAddTracingConfig.mockResolvedValue(undefined)
    mockUpdateTracingConfig.mockResolvedValue(undefined)
    mockRemoveTracingConfig.mockResolvedValue(undefined)
  })

  it.each(saveCases)('should render and save %s provider configs in add mode', async ({ provider, fields, expected }) => {
    const onSaved = vi.fn()
    const onChosen = vi.fn()

    render(
      <ProviderConfigModal
        appId="app-1"
        type={provider}
        onRemoved={vi.fn()}
        onCancel={vi.fn()}
        onSaved={onSaved}
        onChosen={onChosen}
      />,
    )

    fillFields(fields)
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.saveAndEnable' }))

    await waitFor(() => {
      expect(mockAddTracingConfig).toHaveBeenCalledWith({
        appId: 'app-1',
        body: {
          tracing_provider: provider,
          tracing_config: expect.objectContaining(expected),
        },
      })
    })

    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining(expected))
    expect(onChosen).toHaveBeenCalledWith(provider)
    expect(mockToast).toHaveBeenCalledWith('common.api.success', { type: 'success' })
  })

  it.each(invalidCases)('should surface validation errors for invalid %s configs', ({ provider, fields }) => {
    render(
      <ProviderConfigModal
        appId="app-1"
        type={provider}
        onRemoved={vi.fn()}
        onCancel={vi.fn()}
        onSaved={vi.fn()}
        onChosen={vi.fn()}
      />,
    )

    fields?.forEach(({ label, value }) => {
      fireEvent.change(screen.getByLabelText(label), { target: { value } })
    })

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.saveAndEnable' }))

    expect(mockAddTracingConfig).not.toHaveBeenCalled()
    expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('common.errorMsg.fieldRequired'), { type: 'error' })
  })

  it('should update existing configs without re-choosing the provider', async () => {
    const payload: LangSmithConfig = {
      api_key: 'existing-key',
      project: 'existing-project',
      endpoint: 'https://smith.example',
    }
    const onChosen = vi.fn()
    const onSaved = vi.fn()

    render(
      <ProviderConfigModal
        appId="app-1"
        type={TracingProvider.langSmith}
        payload={payload}
        onRemoved={vi.fn()}
        onCancel={vi.fn()}
        onSaved={onSaved}
        onChosen={onChosen}
      />,
    )

    fireEvent.change(screen.getByLabelText('Endpoint'), { target: { value: 'https://updated.example' } })
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))

    await waitFor(() => {
      expect(mockUpdateTracingConfig).toHaveBeenCalledWith({
        appId: 'app-1',
        body: {
          tracing_provider: TracingProvider.langSmith,
          tracing_config: expect.objectContaining({
            api_key: 'existing-key',
            project: 'existing-project',
            endpoint: 'https://updated.example',
          }),
        },
      })
    })

    expect(onSaved).toHaveBeenCalled()
    expect(onChosen).not.toHaveBeenCalled()
  })

  it('should confirm and remove an existing config', async () => {
    const payload: WeaveConfig = {
      api_key: 'weave-key',
      project: 'weave-project',
      entity: '',
      endpoint: '',
      host: '',
    }
    const onRemoved = vi.fn()

    render(
      <ProviderConfigModal
        appId="app-1"
        type={TracingProvider.weave}
        payload={payload}
        onRemoved={onRemoved}
        onCancel={vi.fn()}
        onSaved={vi.fn()}
        onChosen={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.remove' }))
    fireEvent.click(screen.getByRole('button', { name: 'confirm-remove' }))

    await waitFor(() => {
      expect(mockRemoveTracingConfig).toHaveBeenCalledWith({
        appId: 'app-1',
        provider: TracingProvider.weave,
      })
    })

    expect(onRemoved).toHaveBeenCalledTimes(1)
    expect(mockToast).toHaveBeenCalledWith('common.api.remove', { type: 'success' })
  })
})
