import type { TraceConfigPayload } from '@dify/contracts/api/console/apps/types.gen'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from '@/app/notifications'
import { createQueryClientWrapper } from '@/test/console/query-client'
import { createTestQueryClient } from '@/test/query-client'
import ConfigBtn from '../config-button'
import ProviderConfigModal from '../provider-config-modal'
import { TracingProvider } from '../type'

const { request } = vi.hoisted(() => ({
  request:
    vi.fn<(url: string, init: RequestInit, options: { request: Request }) => Promise<Response>>(),
}))
vi.mock('@/service/base', () => ({ request }))

const expectRequest = async (method: string, body?: unknown) => {
  expect(request).toHaveBeenCalledOnce()
  const sent = request.mock.calls[0]![2].request
  expect(sent.method).toBe(method)
  expect(new URL(sent.url).pathname).toMatch(/\/apps\/app-id\/trace-config$/)
  if (body) expect(await sent.clone().json()).toEqual(body)
  else expect(new URL(sent.url).searchParams.get('tracing_provider')).toBe(TracingProvider.langfuse)
}

vi.mock('@/app/notifications', () => ({
  toast: vi.fn(),
}))

const validConfigs = {
  [TracingProvider.arize]: {
    api_key: 'arize-api-key',
    space_id: 'space-id',
    project: 'arize-project',
    endpoint: 'https://otlp.arize.com',
  },
  [TracingProvider.phoenix]: {
    api_key: 'phoenix-api-key',
    project: 'phoenix-project',
    endpoint: 'https://app.phoenix.arize.com',
  },
  [TracingProvider.langSmith]: {
    api_key: 'langsmith-api-key',
    project: 'langsmith-project',
    endpoint: 'https://api.smith.langchain.com',
  },
  [TracingProvider.langfuse]: {
    public_key: 'public-key',
    secret_key: 'secret-key',
    host: 'https://cloud.langfuse.com',
  },
  [TracingProvider.opik]: {
    api_key: 'opik-api-key',
    project: 'opik-project',
    workspace: 'default',
    url: 'https://www.comet.com/opik/api/',
  },
  [TracingProvider.weave]: {
    api_key: 'weave-api-key',
    entity: 'wandb-entity',
    project: 'weave-project',
    endpoint: 'https://trace.wandb.ai/',
    host: 'https://api.wandb.ai',
  },
  [TracingProvider.aliyun]: {
    app_name: 'aliyun-app',
    license_key: 'license-key',
    endpoint: 'https://tracing.arms.aliyuncs.com',
  },
  [TracingProvider.mlflow]: {
    tracking_uri: 'http://localhost:5000',
    experiment_id: 'experiment-id',
    username: 'mlflow-user',
    password: 'mlflow-password',
  },
  [TracingProvider.databricks]: {
    experiment_id: 'experiment-id',
    host: 'https://workspace.cloud.databricks.com',
    client_id: 'client-id',
    client_secret: 'client-secret',
    personal_access_token: 'personal-access-token',
  },
  [TracingProvider.tencent]: {
    token: 'tencent-token',
    endpoint: 'https://your-region.cls.tencentcs.com',
    service_name: 'dify_app',
  },
} satisfies Record<TracingProvider, TraceConfigPayload['tracing_config']>

const providerFieldLabels = [
  [
    TracingProvider.arize,
    ['API Key', 'Space ID', 'app.tracing.configProvider.project', 'Endpoint'],
  ],
  [TracingProvider.phoenix, ['API Key', 'app.tracing.configProvider.project', 'Endpoint']],
  [TracingProvider.langSmith, ['API Key', 'app.tracing.configProvider.project', 'Endpoint']],
  [
    TracingProvider.langfuse,
    ['app.tracing.configProvider.secretKey', 'app.tracing.configProvider.publicKey', 'Host'],
  ],
  [TracingProvider.opik, ['API Key', 'app.tracing.configProvider.project', 'Workspace', 'Url']],
  [
    TracingProvider.weave,
    ['API Key', 'app.tracing.configProvider.project', 'Entity', 'Endpoint', 'Host'],
  ],
  [TracingProvider.aliyun, ['License Key', 'Endpoint', 'App Name']],
  [
    TracingProvider.mlflow,
    [
      'app.tracing.configProvider.trackingUri',
      'app.tracing.configProvider.experimentId',
      'app.tracing.configProvider.username',
      'app.tracing.configProvider.password',
    ],
  ],
  [
    TracingProvider.databricks,
    [
      'app.tracing.configProvider.experimentId',
      'app.tracing.configProvider.databricksHost',
      'app.tracing.configProvider.clientId',
      'app.tracing.configProvider.clientSecret',
      'app.tracing.configProvider.personalAccessToken',
    ],
  ],
  [TracingProvider.tencent, ['Token', 'Endpoint', 'Service Name']],
] as const

const invalidConfigCases: Array<{
  provider: TracingProvider
  payload: TraceConfigPayload['tracing_config']
  missingField: string
}> = [
  {
    provider: TracingProvider.arize,
    payload: { ...validConfigs[TracingProvider.arize], api_key: '' },
    missingField: 'API Key',
  },
  {
    provider: TracingProvider.arize,
    payload: { ...validConfigs[TracingProvider.arize], space_id: '' },
    missingField: 'Space ID',
  },
  {
    provider: TracingProvider.arize,
    payload: { ...validConfigs[TracingProvider.arize], project: '' },
    missingField: 'app.tracing.configProvider.project',
  },
  {
    provider: TracingProvider.phoenix,
    payload: { ...validConfigs[TracingProvider.phoenix], api_key: '' },
    missingField: 'API Key',
  },
  {
    provider: TracingProvider.phoenix,
    payload: { ...validConfigs[TracingProvider.phoenix], project: '' },
    missingField: 'app.tracing.configProvider.project',
  },
  {
    provider: TracingProvider.langSmith,
    payload: { ...validConfigs[TracingProvider.langSmith], api_key: '' },
    missingField: 'API Key',
  },
  {
    provider: TracingProvider.langSmith,
    payload: { ...validConfigs[TracingProvider.langSmith], project: '' },
    missingField: 'app.tracing.configProvider.project',
  },
  {
    provider: TracingProvider.langfuse,
    payload: { ...validConfigs[TracingProvider.langfuse], secret_key: '' },
    missingField: 'app.tracing.configProvider.secretKey',
  },
  {
    provider: TracingProvider.langfuse,
    payload: { ...validConfigs[TracingProvider.langfuse], public_key: '' },
    missingField: 'app.tracing.configProvider.publicKey',
  },
  {
    provider: TracingProvider.langfuse,
    payload: { ...validConfigs[TracingProvider.langfuse], host: '' },
    missingField: 'Host',
  },
  {
    provider: TracingProvider.weave,
    payload: { ...validConfigs[TracingProvider.weave], api_key: '' },
    missingField: 'API Key',
  },
  {
    provider: TracingProvider.weave,
    payload: { ...validConfigs[TracingProvider.weave], project: '' },
    missingField: 'app.tracing.configProvider.project',
  },
  {
    provider: TracingProvider.aliyun,
    payload: { ...validConfigs[TracingProvider.aliyun], app_name: '' },
    missingField: 'App Name',
  },
  {
    provider: TracingProvider.aliyun,
    payload: { ...validConfigs[TracingProvider.aliyun], license_key: '' },
    missingField: 'License Key',
  },
  {
    provider: TracingProvider.aliyun,
    payload: { ...validConfigs[TracingProvider.aliyun], endpoint: '' },
    missingField: 'Endpoint',
  },
  {
    provider: TracingProvider.mlflow,
    payload: { ...validConfigs[TracingProvider.mlflow], tracking_uri: '' },
    missingField: 'Tracking URI',
  },
  {
    provider: TracingProvider.databricks,
    payload: { ...validConfigs[TracingProvider.databricks], experiment_id: '' },
    missingField: 'Experiment ID',
  },
  {
    provider: TracingProvider.databricks,
    payload: { ...validConfigs[TracingProvider.databricks], host: '' },
    missingField: 'Host',
  },
  {
    provider: TracingProvider.tencent,
    payload: { ...validConfigs[TracingProvider.tencent], token: '' },
    missingField: 'Token',
  },
  {
    provider: TracingProvider.tencent,
    payload: { ...validConfigs[TracingProvider.tencent], endpoint: '' },
    missingField: 'Endpoint',
  },
  {
    provider: TracingProvider.tencent,
    payload: { ...validConfigs[TracingProvider.tencent], service_name: '' },
    missingField: 'Service Name',
  },
]

const renderConfigButton = () => {
  return render(
    <ConfigBtn
      appId="app-id"
      readOnly={false}
      hasConfigured={false}
      enabled={false}
      onStatusChange={vi.fn()}
      chosenProvider={null}
      onChooseProvider={vi.fn()}
      arizeConfig={null}
      phoenixConfig={null}
      langSmithConfig={null}
      langFuseConfig={null}
      opikConfig={null}
      weaveConfig={null}
      aliyunConfig={null}
      mlflowConfig={null}
      databricksConfig={null}
      tencentConfig={null}
      onConfigRemoved={vi.fn()}
    >
      <button type="button">Open tracing</button>
    </ConfigBtn>,
    { wrapper: createQueryClientWrapper(createTestQueryClient()) },
  )
}

const renderProviderConfigModal = ({
  type = TracingProvider.langfuse,
  payload,
}: {
  type?: TracingProvider
  payload?: TraceConfigPayload['tracing_config'] | null
} = {}) => {
  const callbacks = {
    onCancel: vi.fn(),
    onSaved: vi.fn(),
    onChosen: vi.fn(),
    onRemoved: vi.fn(),
  }

  render(
    <ProviderConfigModal
      appId="app-id"
      type={type}
      payload={payload}
      onCancel={callbacks.onCancel}
      onSaved={callbacks.onSaved}
      onChosen={callbacks.onChosen}
      onRemoved={callbacks.onRemoved}
    />,
    { wrapper: createQueryClientWrapper(createTestQueryClient()) },
  )

  return callbacks
}

describe('ProviderConfigModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    request.mockImplementation(async (_url, _init, { request: sent }) =>
      sent.method === 'DELETE'
        ? new Response(null, { status: 204 })
        : Response.json({ result: 'success' }),
    )
  })

  describe('Nested Overlay Behavior', () => {
    it('should keep the provider config modal open when clicking inside it', async () => {
      const user = userEvent.setup()
      renderConfigButton()

      await user.click(screen.getByRole('button', { name: 'Open tracing' }))
      await waitFor(() => {
        expect(screen.getByText('app.tracing.tracing')).toBeInTheDocument()
      })

      const configActions = screen.getAllByText('app.tracing.config')
      expect(configActions.length).toBeGreaterThan(0)
      await user.click(configActions[0]!)
      await waitFor(() => {
        expect(
          screen.getByText('app.tracing.configProvider.titleapp.tracing.langfuse.title'),
        ).toBeInTheDocument()
      })
      expect(screen.getByRole('dialog')).toBeInTheDocument()

      await user.click(screen.getByPlaceholderText('https://cloud.langfuse.com'))

      expect(screen.getByText('app.tracing.tracing')).toBeInTheDocument()
      expect(
        screen.getByText('app.tracing.configProvider.titleapp.tracing.langfuse.title'),
      ).toBeInTheDocument()
    })
  })

  describe('Rendering', () => {
    it.each(providerFieldLabels)(
      'should render %s fields when adding a provider',
      (provider, expectedLabels) => {
        renderProviderConfigModal({ type: provider })

        expect(
          screen.getByText(`app.tracing.configProvider.titleapp.tracing.${provider}.title`),
        ).toBeInTheDocument()
        expectedLabels.forEach((label) => {
          expect(screen.getByRole('textbox', { name: label })).toBeInTheDocument()
        })
        expect(
          screen.getByRole('button', { name: 'common.operation.saveAndEnable' }),
        ).toBeInTheDocument()
      },
    )
  })

  describe('Saving', () => {
    it('should add and choose the provider when saving a new config', async () => {
      const user = userEvent.setup()
      const callbacks = renderProviderConfigModal({ type: TracingProvider.langfuse })

      await user.type(
        screen.getByRole('textbox', { name: 'app.tracing.configProvider.secretKey' }),
        'secret-key',
      )
      await user.type(
        screen.getByRole('textbox', { name: 'app.tracing.configProvider.publicKey' }),
        'public-key',
      )
      await user.type(screen.getByRole('textbox', { name: 'Host' }), 'https://cloud.langfuse.com')
      await user.click(screen.getByRole('button', { name: 'common.operation.saveAndEnable' }))

      await waitFor(() => expect(callbacks.onSaved).toHaveBeenCalledOnce())
      await expectRequest('POST', {
        tracing_provider: TracingProvider.langfuse,
        tracing_config: validConfigs[TracingProvider.langfuse],
      })
      expect(callbacks.onChosen).toHaveBeenCalledWith(TracingProvider.langfuse)
      expect(toast).toHaveBeenCalledWith('common.api.success', { type: 'success' })
    })

    it.each(Object.values(TracingProvider))(
      'should update valid %s config in edit mode',
      async (provider) => {
        const user = userEvent.setup()
        const callbacks = renderProviderConfigModal({
          type: provider,
          payload: validConfigs[provider],
        })

        await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

        await waitFor(() => expect(callbacks.onSaved).toHaveBeenCalledOnce())
        await expectRequest('PATCH', {
          tracing_provider: provider,
          tracing_config: validConfigs[provider],
        })
        expect(callbacks.onChosen).not.toHaveBeenCalled()
      },
    )

    it('displays nullable provider fields as empty without changing their submitted values', async () => {
      const user = userEvent.setup()
      const payload = { ...validConfigs[TracingProvider.mlflow], username: null }
      const callbacks = renderProviderConfigModal({ type: TracingProvider.mlflow, payload })

      expect(
        screen.getByRole('textbox', { name: 'app.tracing.configProvider.username' }),
      ).toHaveValue('')
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

      await waitFor(() => expect(callbacks.onSaved).toHaveBeenCalledOnce())
      await expectRequest('PATCH', {
        tracing_provider: TracingProvider.mlflow,
        tracing_config: payload,
      })
    })

    it('keeps the draft on failure, prevents duplicate saves while pending, and allows retry', async () => {
      const user = userEvent.setup()
      let resolveResponse!: (response: Response) => void
      request.mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          resolveResponse = resolve
        }),
      )
      const logError = vi.spyOn(console, 'error').mockImplementation(() => {})
      const callbacks = renderProviderConfigModal({
        payload: validConfigs[TracingProvider.langfuse],
      })
      const host = screen.getByRole('textbox', { name: 'Host' })
      await user.clear(host)
      await user.type(host, 'https://draft.langfuse.com')
      const save = screen.getByRole('button', { name: 'common.operation.save' })

      try {
        await user.click(save)
        await waitFor(() => expect(save).toHaveAttribute('aria-disabled', 'true'))
        await user.click(save)
        expect(request).toHaveBeenCalledOnce()
        resolveResponse(Response.json({ message: 'Config rejected' }, { status: 400 }))

        await waitFor(() => expect(save).not.toHaveAttribute('aria-disabled', 'true'))
        expect(host).toHaveValue('https://draft.langfuse.com')
        expect(callbacks.onSaved).not.toHaveBeenCalled()
        expect(callbacks.onChosen).not.toHaveBeenCalled()

        await user.click(save)
        await waitFor(() => expect(callbacks.onSaved).toHaveBeenCalledOnce())
        expect(request).toHaveBeenCalledTimes(2)
      } finally {
        logError.mockRestore()
      }
    })

    it.each(invalidConfigCases)(
      'should reject $provider config when $missingField is missing',
      async ({ provider, payload, missingField }) => {
        const user = userEvent.setup()
        renderProviderConfigModal({
          type: provider,
          payload,
        })

        await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

        expect(request).not.toHaveBeenCalled()
        expect(toast).toHaveBeenCalledWith(expect.stringContaining(missingField), { type: 'error' })
      },
    )
  })

  describe('Closing And Removing', () => {
    it('should cancel when the cancel button is clicked', async () => {
      const user = userEvent.setup()
      const callbacks = renderProviderConfigModal()

      await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

      expect(callbacks.onCancel).toHaveBeenCalledTimes(1)
    })

    it('should cancel when the dialog is closed with Escape', async () => {
      const user = userEvent.setup()
      const callbacks = renderProviderConfigModal()

      await user.keyboard('{Escape}')

      await waitFor(() => {
        expect(callbacks.onCancel).toHaveBeenCalledTimes(1)
      })
    })

    it('should remove an existing provider after confirmation', async () => {
      const user = userEvent.setup()
      const callbacks = renderProviderConfigModal({
        type: TracingProvider.langfuse,
        payload: validConfigs[TracingProvider.langfuse],
      })

      await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))
      expect(
        screen.getByText(
          'app.tracing.configProvider.removeConfirmTitle:{"key":"app.tracing.langfuse.title"}',
        ),
      ).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

      await waitFor(() => expect(callbacks.onRemoved).toHaveBeenCalledOnce())
      await expectRequest('DELETE')
      expect(toast).toHaveBeenCalledWith('common.api.remove', { type: 'success' })
    })

    it('should return to the edit dialog when remove confirmation is canceled', async () => {
      const user = userEvent.setup()
      renderProviderConfigModal({
        type: TracingProvider.langfuse,
        payload: validConfigs[TracingProvider.langfuse],
      })

      await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))
      await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

      expect(request).not.toHaveBeenCalled()
      expect(
        screen.getByText('app.tracing.configProvider.titleapp.tracing.langfuse.title'),
      ).toBeInTheDocument()
    })
  })
})
