import type { TraceConfigPayload } from '@dify/contracts/api/console/apps/types.gen'
import type { ConfigurableTracingProvider } from '../providers'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { toast } from '@/app/notifications'
import { httpErrorFromResponse } from '@/service/http-error'
import { createQueryClientWrapper } from '@/test/console/query-client'
import { createTestQueryClient } from '@/test/query-client'
import { ProviderConfigModal } from '../provider-config-modal'
import { configurableProviders } from '../providers'

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
  else expect(new URL(sent.url).searchParams.get('tracing_provider')).toBe('langfuse')
}

vi.mock('@/app/notifications', () => ({
  toast: vi.fn(),
}))

const validConfigs = {
  arize: {
    api_key: 'arize-api-key',
    space_id: 'space-id',
    project: 'arize-project',
    endpoint: 'https://otlp.arize.com',
  },
  phoenix: {
    api_key: 'phoenix-api-key',
    project: 'phoenix-project',
    endpoint: 'https://app.phoenix.arize.com',
  },
  langsmith: {
    api_key: 'langsmith-api-key',
    project: 'langsmith-project',
    endpoint: 'https://api.smith.langchain.com',
  },
  langfuse: {
    public_key: 'public-key',
    secret_key: 'secret-key',
    host: 'https://cloud.langfuse.com',
  },
  opik: {
    api_key: 'opik-api-key',
    project: 'opik-project',
    workspace: 'default',
    url: 'https://www.comet.com/opik/api/',
  },
  weave: {
    api_key: 'weave-api-key',
    entity: 'wandb-entity',
    project: 'weave-project',
    endpoint: 'https://trace.wandb.ai/',
    host: 'https://api.wandb.ai',
  },
  aliyun: {
    app_name: 'aliyun-app',
    license_key: 'license-key',
    endpoint: 'https://tracing.arms.aliyuncs.com',
  },
  mlflow: {
    tracking_uri: 'http://localhost:5000',
    experiment_id: '123',
    username: 'mlflow-user',
    password: 'mlflow-password',
  },
  databricks: {
    experiment_id: '123',
    host: 'https://workspace.cloud.databricks.com',
    client_id: 'client-id',
    client_secret: 'client-secret',
    personal_access_token: 'personal-access-token',
  },
  tencent: {
    token: 'tencent-token',
    endpoint: 'https://your-region.cls.tencentcs.com',
    service_name: 'dify_app',
  },
} satisfies Record<ConfigurableTracingProvider, TraceConfigPayload['tracing_config']>

const providerFieldLabels = [
  ['arize', ['API Key', 'Space ID', 'app.tracing.configProvider.project', 'Endpoint']],
  ['phoenix', ['API Key', 'app.tracing.configProvider.project', 'Endpoint']],
  ['langsmith', ['API Key', 'app.tracing.configProvider.project', 'Endpoint']],
  [
    'langfuse',
    ['app.tracing.configProvider.secretKey', 'app.tracing.configProvider.publicKey', 'Host'],
  ],
  ['opik', ['API Key', 'app.tracing.configProvider.project', 'Workspace', 'Url']],
  ['weave', ['API Key', 'app.tracing.configProvider.project', 'Entity', 'Endpoint', 'Host']],
  ['aliyun', ['License Key', 'Endpoint', 'App Name']],
  [
    'mlflow',
    [
      'app.tracing.configProvider.trackingUri',
      'app.tracing.configProvider.experimentId',
      'app.tracing.configProvider.username',
      'app.tracing.configProvider.password',
    ],
  ],
  [
    'databricks',
    [
      'app.tracing.configProvider.experimentId',
      'app.tracing.configProvider.databricksHost',
      'app.tracing.configProvider.clientId',
      'app.tracing.configProvider.clientSecret',
      'app.tracing.configProvider.personalAccessToken',
    ],
  ],
  ['tencent', ['Token', 'Endpoint', 'Service Name']],
] as const

const invalidConfigCases: Array<{
  provider: ConfigurableTracingProvider
  payload: TraceConfigPayload['tracing_config']
  missingField: string
}> = [
  {
    provider: 'arize',
    payload: { ...validConfigs.arize, api_key: '' },
    missingField: 'API Key',
  },
  {
    provider: 'arize',
    payload: { ...validConfigs.arize, space_id: '' },
    missingField: 'Space ID',
  },
  {
    provider: 'arize',
    payload: { ...validConfigs.arize, project: '' },
    missingField: 'app.tracing.configProvider.project',
  },
  {
    provider: 'phoenix',
    payload: { ...validConfigs.phoenix, api_key: '' },
    missingField: 'API Key',
  },
  {
    provider: 'phoenix',
    payload: { ...validConfigs.phoenix, project: '' },
    missingField: 'app.tracing.configProvider.project',
  },
  {
    provider: 'langsmith',
    payload: { ...validConfigs.langsmith, api_key: '' },
    missingField: 'API Key',
  },
  {
    provider: 'langsmith',
    payload: { ...validConfigs.langsmith, project: '' },
    missingField: 'app.tracing.configProvider.project',
  },
  {
    provider: 'langfuse',
    payload: { ...validConfigs.langfuse, secret_key: '' },
    missingField: 'app.tracing.configProvider.secretKey',
  },
  {
    provider: 'langfuse',
    payload: { ...validConfigs.langfuse, public_key: '' },
    missingField: 'app.tracing.configProvider.publicKey',
  },
  {
    provider: 'langfuse',
    payload: { ...validConfigs.langfuse, host: '' },
    missingField: 'Host',
  },
  {
    provider: 'weave',
    payload: { ...validConfigs.weave, api_key: '' },
    missingField: 'API Key',
  },
  {
    provider: 'weave',
    payload: { ...validConfigs.weave, project: '' },
    missingField: 'app.tracing.configProvider.project',
  },
  {
    provider: 'aliyun',
    payload: { ...validConfigs.aliyun, app_name: '' },
    missingField: 'App Name',
  },
  {
    provider: 'aliyun',
    payload: { ...validConfigs.aliyun, license_key: '' },
    missingField: 'License Key',
  },
  {
    provider: 'aliyun',
    payload: { ...validConfigs.aliyun, endpoint: '' },
    missingField: 'Endpoint',
  },
  {
    provider: 'mlflow',
    payload: { ...validConfigs.mlflow, tracking_uri: '' },
    missingField: 'app.tracing.configProvider.trackingUri',
  },
  {
    provider: 'databricks',
    payload: { ...validConfigs.databricks, experiment_id: '' },
    missingField: 'app.tracing.configProvider.experimentId',
  },
  {
    provider: 'databricks',
    payload: { ...validConfigs.databricks, host: '' },
    missingField: 'app.tracing.configProvider.databricksHost',
  },
  {
    provider: 'tencent',
    payload: { ...validConfigs.tencent, token: '' },
    missingField: 'Token',
  },
  {
    provider: 'tencent',
    payload: { ...validConfigs.tencent, endpoint: '' },
    missingField: 'Endpoint',
  },
  {
    provider: 'tencent',
    payload: { ...validConfigs.tencent, service_name: '' },
    missingField: 'Service Name',
  },
]

const renderProviderConfigModal = ({
  type = 'langfuse',
  payload,
}: {
  type?: ConfigurableTracingProvider
  payload?: TraceConfigPayload['tracing_config'] | null
} = {}) => {
  const callbacks = {
    onCancel: vi.fn(),
    onSaved: vi.fn(),
    onRemoved: vi.fn(),
  }

  const firstInputRef = createRef<HTMLInputElement>()
  render(
    <Dialog
      defaultOpen
      disablePointerDismissal
      onOpenChangeComplete={(open) => {
        if (!open) callbacks.onCancel()
      }}
    >
      <DialogContent initialFocus={firstInputRef}>
        <ProviderConfigModal
          resource={{ kind: 'app', appId: 'app-id' }}
          type={type}
          payload={payload}
          firstInputRef={firstInputRef}
          onSaved={callbacks.onSaved}
          onRemoved={callbacks.onRemoved}
        />
      </DialogContent>
    </Dialog>,
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

  describe('Rendering', () => {
    it.each(providerFieldLabels)(
      'should render %s fields when adding a provider',
      async (provider, expectedLabels) => {
        renderProviderConfigModal({ type: provider })

        expect(
          screen.getByText(`app.tracing.configProvider.titleapp.tracing.${provider}.title`),
        ).toBeInTheDocument()
        expectedLabels.forEach((label) => {
          expect(screen.getByRole('textbox', { name: label })).toBeInTheDocument()
        })
        await waitFor(() =>
          expect(screen.getByRole('textbox', { name: expectedLabels[0] })).toHaveFocus(),
        )
        expect(
          screen.getByRole('button', { name: 'common.operation.saveAndEnable' }),
        ).toBeInTheDocument()
      },
    )
  })

  describe('Saving', () => {
    it('submits a new config with Enter and chooses the provider', async () => {
      const user = userEvent.setup()
      const callbacks = renderProviderConfigModal({ type: 'langfuse' })

      await user.type(
        screen.getByRole('textbox', { name: 'app.tracing.configProvider.secretKey' }),
        'secret-key',
      )
      await user.type(
        screen.getByRole('textbox', { name: 'app.tracing.configProvider.publicKey' }),
        'public-key',
      )
      await user.type(screen.getByRole('textbox', { name: 'Host' }), 'https://cloud.langfuse.com')
      await user.keyboard('{Enter}')

      await waitFor(() => expect(callbacks.onSaved).toHaveBeenCalledOnce())
      await expectRequest('POST', {
        tracing_provider: 'langfuse',
        tracing_config: validConfigs.langfuse,
        activate: true,
      })
      expect(toast).not.toHaveBeenCalled()
    })

    it.each(configurableProviders)(
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
        expect(request).toHaveBeenCalledOnce()
      },
    )

    it.each([
      ['langfuse', 'host', 'HTTPS://cloud.langfuse.com'],
      ['langsmith', 'endpoint', 'HTTPS://api.smith.langchain.com'],
      ['opik', 'url', 'HTTPS://www.comet.com/opik/api/'],
    ] as const)('accepts case-insensitive URL schemes for %s', async (provider, key, value) => {
      const user = userEvent.setup()
      const payload = { ...validConfigs[provider], [key]: value }
      const callbacks = renderProviderConfigModal({ type: provider, payload })

      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

      await waitFor(() => expect(callbacks.onSaved).toHaveBeenCalledOnce())
      await expectRequest('PATCH', { tracing_provider: provider, tracing_config: payload })
    })

    it('displays nullable provider fields as empty without changing their submitted values', async () => {
      const user = userEvent.setup()
      const payload = { ...validConfigs.mlflow, username: null }
      const callbacks = renderProviderConfigModal({ type: 'mlflow', payload })

      expect(
        screen.getByRole('textbox', { name: 'app.tracing.configProvider.username' }),
      ).toHaveValue('')
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

      await waitFor(() => expect(callbacks.onSaved).toHaveBeenCalledOnce())
      await expectRequest('PATCH', {
        tracing_provider: 'mlflow',
        tracing_config: payload,
      })
    })

    it('keeps the draft on failure, prevents duplicate saves while pending, and allows retry', async () => {
      const user = userEvent.setup()
      let resolveResponse!: (response: Response) => void
      request.mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          resolveResponse = resolve
        }).then(async (response) => {
          if (!response.ok) throw await httpErrorFromResponse(response)
          return response
        }),
      )
      const logError = vi.spyOn(console, 'error').mockImplementation(() => {})
      const callbacks = renderProviderConfigModal({
        payload: validConfigs.langfuse,
      })
      const host = screen.getByRole('textbox', { name: 'Host' })
      await user.clear(host)
      await user.type(host, 'https://draft.langfuse.com')
      const save = screen.getByRole('button', { name: 'common.operation.save' })

      try {
        await user.click(save)
        await waitFor(() => expect(save).toHaveAttribute('aria-disabled', 'true'))
        for (const input of screen.getAllByRole('textbox')) expect(input).toBeDisabled()
        await user.type(host, '/unsaved')
        expect(host).toHaveValue('https://draft.langfuse.com')
        await user.click(save)
        await waitFor(() => expect(request).toHaveBeenCalledOnce())
        resolveResponse(Response.json({ message: 'Config rejected' }, { status: 400 }))

        await waitFor(() => expect(save).not.toHaveAttribute('aria-disabled', 'true'))
        for (const input of screen.getAllByRole('textbox')) expect(input).toBeEnabled()
        expect(host).toHaveValue('https://draft.langfuse.com')
        expect(screen.getByRole('alert')).toHaveTextContent('Config rejected')
        expect(request.mock.calls[0]![2]).toMatchObject({ silent: true })
        expect(toast).not.toHaveBeenCalled()
        expect(callbacks.onSaved).not.toHaveBeenCalled()
        expect(request).toHaveBeenCalledOnce()

        await user.click(save)
        await waitFor(() => expect(callbacks.onSaved).toHaveBeenCalledOnce())
        expect(request).toHaveBeenCalledTimes(2)
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      } finally {
        logError.mockRestore()
      }
    })

    it.each([
      ['langfuse', 'host', 'Host', 'ftp://cloud.langfuse.com'],
      ['langsmith', 'endpoint', 'Endpoint', 'http://api.smith.langchain.com'],
      ['weave', 'endpoint', 'Endpoint', 'http://trace.wandb.ai'],
      ['opik', 'url', 'Url', 'https://www.comet.com/opik/'],
      ['mlflow', 'experiment_id', 'app.tracing.configProvider.experimentId', '1.5'],
      ['databricks', 'experiment_id', 'app.tracing.configProvider.experimentId', '-1'],
      ['aliyun', 'license_key', 'License Key', '   '],
      ['tencent', 'token', 'Token', '   '],
    ] as const)(
      'validates %s %s inline before sending credentials',
      async (provider, key, label, value) => {
        const user = userEvent.setup()
        const callbacks = renderProviderConfigModal({
          type: provider,
          payload: { ...validConfigs[provider], [key]: value },
        })
        const field = screen.getByRole('textbox', { name: label })
        await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

        expect(request).not.toHaveBeenCalled()
        expect(field).toBeInvalid()
        expect(field).toHaveFocus()
        expect(field).toHaveAccessibleDescription()

        await user.clear(field)
        const validConfig: TraceConfigPayload['tracing_config'] = validConfigs[provider]
        await user.type(field, validConfig[key] ?? '')
        await user.keyboard('{Enter}')

        await waitFor(() => expect(callbacks.onSaved).toHaveBeenCalledOnce())
        expect(field).toBeValid()
        await expectRequest('PATCH', {
          tracing_provider: provider,
          tracing_config: validConfigs[provider],
        })
      },
    )

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
        const field = screen.getByRole('textbox', { name: missingField })
        expect(field).toBeInvalid()
        expect(field).toHaveFocus()
        expect(field).toHaveAccessibleDescription()
        expect(toast).not.toHaveBeenCalled()
      },
    )
  })

  describe('Closing And Removing', () => {
    it.each(['cancel', 'close'])('should dismiss when the %s button is clicked', async (action) => {
      const user = userEvent.setup()
      const callbacks = renderProviderConfigModal()

      await user.click(screen.getByRole('button', { name: `common.operation.${action}` }))

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
        type: 'langfuse',
        payload: validConfigs.langfuse,
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
      expect(toast).not.toHaveBeenCalled()
    })

    it('keeps the draft and returns focus to Remove when confirmation is canceled', async () => {
      const user = userEvent.setup()
      renderProviderConfigModal({
        type: 'langfuse',
        payload: validConfigs.langfuse,
      })

      const host = screen.getByRole('textbox', { name: 'Host' })
      await user.clear(host)
      await user.type(host, 'https://draft.langfuse.com')
      await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))
      await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
      expect(host).toHaveValue('https://draft.langfuse.com')
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'common.operation.remove' })).toHaveFocus(),
      )
      expect(request).not.toHaveBeenCalled()
      expect(
        screen.getByText('app.tracing.configProvider.titleapp.tracing.langfuse.title'),
      ).toBeInTheDocument()
    })
  })
})
