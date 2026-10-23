import type {
  TraceAppConfigResponse,
  TraceConfigPayload,
} from '@dify/contracts/api/console/apps/types.gen'
import type { ConfigurableTracingProvider } from '../providers'
import type { TracingResource } from '../resource'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
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

const expectRequest = async (
  method: string,
  body?: unknown,
  path = '/apps/app-id/trace-config',
) => {
  expect(request).toHaveBeenCalledOnce()
  const sent = request.mock.calls[0]![2].request
  expect(sent.method).toBe(method)
  expect(new URL(sent.url).pathname).toBe(`/console/api${path}`)
  if (body) expect(await sent.clone().json()).toEqual(body)
  else expect(new URL(sent.url).searchParams.get('tracing_provider')).toBe('langfuse')
}

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
    endpoint: 'https://ap-guangzhou.apm.tencentcs.com:4320',
    service_name: 'dify-app',
  },
} satisfies Record<ConfigurableTracingProvider, TraceConfigPayload['tracing_config']>

// The fields each provider's backend config declares with `secret()`, by input label.
const secretLabels = {
  arize: { api_key: 'API Key', space_id: 'Space ID' },
  phoenix: { api_key: 'API Key' },
  langsmith: { api_key: 'API Key' },
  langfuse: {
    secret_key: 'app.tracing.configProvider.secretKey',
    public_key: 'app.tracing.configProvider.publicKey',
  },
  opik: { api_key: 'API Key' },
  weave: { api_key: 'API Key' },
  aliyun: { license_key: 'License Key' },
  mlflow: { password: 'app.tracing.configProvider.password' },
  databricks: {
    client_secret: 'app.tracing.configProvider.clientSecret',
    personal_access_token: 'app.tracing.configProvider.personalAccessToken',
  },
  tencent: { token: 'Token' },
} satisfies Record<ConfigurableTracingProvider, Record<string, string>>

const configuredSecretPlaceholder = 'app.tracing.configProvider.configuredSecretPlaceholder'

const isSecret = (provider: ConfigurableTracingProvider, name: string) =>
  Object.hasOwn(secretLabels[provider], name)

/** The submitted `tracing_config` when every secret input is left blank. */
const withoutSecrets = (
  provider: ConfigurableTracingProvider,
  values: TraceConfigPayload['tracing_config'],
) => Object.fromEntries(Object.entries(values).filter(([name]) => !isSecret(provider, name)))

/** The trace-config response for stored `values`: secrets are reported, never returned. */
const savedConfig = (
  provider: ConfigurableTracingProvider,
  values: TraceConfigPayload['tracing_config'],
): TraceAppConfigResponse => ({
  tracing_provider: provider,
  tracing_config: {
    ...withoutSecrets(provider, values),
    project_url: 'https://tracing.example/project',
  },
  configured_secrets: Object.keys(secretLabels[provider]).filter((name) => !!values[name]),
})

const invalidConfigCases: Array<{
  provider: ConfigurableTracingProvider
  values: TraceConfigPayload['tracing_config']
  missingField: string
}> = [
  {
    provider: 'arize',
    values: { ...validConfigs.arize, api_key: '' },
    missingField: 'API Key',
  },
  {
    provider: 'arize',
    values: { ...validConfigs.arize, space_id: '' },
    missingField: 'Space ID',
  },
  {
    provider: 'arize',
    values: { ...validConfigs.arize, project: '' },
    missingField: 'app.tracing.configProvider.project',
  },
  {
    provider: 'phoenix',
    values: { ...validConfigs.phoenix, project: '' },
    missingField: 'app.tracing.configProvider.project',
  },
  {
    provider: 'langsmith',
    values: { ...validConfigs.langsmith, api_key: '' },
    missingField: 'API Key',
  },
  {
    provider: 'langsmith',
    values: { ...validConfigs.langsmith, project: '' },
    missingField: 'app.tracing.configProvider.project',
  },
  {
    provider: 'langfuse',
    values: { ...validConfigs.langfuse, secret_key: '' },
    missingField: 'app.tracing.configProvider.secretKey',
  },
  {
    provider: 'langfuse',
    values: { ...validConfigs.langfuse, public_key: '' },
    missingField: 'app.tracing.configProvider.publicKey',
  },
  {
    provider: 'langfuse',
    values: { ...validConfigs.langfuse, host: '' },
    missingField: 'Host',
  },
  {
    provider: 'weave',
    values: { ...validConfigs.weave, api_key: '' },
    missingField: 'API Key',
  },
  {
    provider: 'weave',
    values: { ...validConfigs.weave, project: '' },
    missingField: 'app.tracing.configProvider.project',
  },
  {
    provider: 'aliyun',
    values: { ...validConfigs.aliyun, app_name: '' },
    missingField: 'App Name',
  },
  {
    provider: 'aliyun',
    values: { ...validConfigs.aliyun, license_key: '' },
    missingField: 'License Key',
  },
  {
    provider: 'aliyun',
    values: { ...validConfigs.aliyun, endpoint: '' },
    missingField: 'Endpoint',
  },
  {
    provider: 'mlflow',
    values: { ...validConfigs.mlflow, tracking_uri: '' },
    missingField: 'app.tracing.configProvider.trackingUri',
  },
  {
    provider: 'databricks',
    values: { ...validConfigs.databricks, experiment_id: '' },
    missingField: 'app.tracing.configProvider.experimentId',
  },
  {
    provider: 'databricks',
    values: { ...validConfigs.databricks, host: '' },
    missingField: 'app.tracing.configProvider.databricksHost',
  },
  {
    provider: 'tencent',
    values: { ...validConfigs.tencent, token: '' },
    missingField: 'Token',
  },
  {
    provider: 'tencent',
    values: { ...validConfigs.tencent, endpoint: '' },
    missingField: 'Endpoint',
  },
  {
    provider: 'tencent',
    values: { ...validConfigs.tencent, service_name: '' },
    missingField: 'Service Name',
  },
]

const renderProviderConfigModal = ({
  type = 'langfuse',
  config,
  inUse = false,
  resource = { kind: 'app', appId: 'app-id', mode: 'chat' },
}: {
  type?: ConfigurableTracingProvider
  config?: TraceAppConfigResponse
  inUse?: boolean
  resource?: TracingResource
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
          resource={resource}
          type={type}
          config={config}
          inUse={inUse}
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
    request.mockImplementation(async (_url, _init, { request: sent }) =>
      sent.method === 'DELETE'
        ? new Response(null, { status: 204 })
        : Response.json({ result: 'success' }),
    )
  })

  describe('Saving', () => {
    it('creates an anonymous Phoenix destination without a key', async () => {
      const user = userEvent.setup()
      const callbacks = renderProviderConfigModal({ type: 'phoenix' })
      expect(screen.getByRole('textbox', { name: 'API Key' })).toHaveAttribute(
        'placeholder',
        'app.tracing.configProvider.placeholder:{"key":"API Key"}',
      )
      await user.type(
        screen.getByRole('textbox', { name: 'app.tracing.configProvider.project' }),
        'local-project',
      )
      await user.type(screen.getByRole('textbox', { name: 'Endpoint' }), 'http://localhost:6006')
      await user.click(screen.getByRole('button', { name: 'common.operation.saveAndEnable' }))
      await waitFor(() => expect(callbacks.onSaved).toHaveBeenCalledOnce())
      await expectRequest('POST', {
        tracing_provider: 'phoenix',
        activate: true,
        tracing_config: {
          project: 'local-project',
          endpoint: 'http://localhost:6006',
        },
      })
    })

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
    })

    it.each(configurableProviders)(
      'updates a saved %s config without prefilling or resending its secrets',
      async (provider) => {
        const user = userEvent.setup()
        const callbacks = renderProviderConfigModal({
          type: provider,
          config: savedConfig(provider, validConfigs[provider]),
        })

        for (const label of Object.values(secretLabels[provider])) {
          const secret = screen.getByRole('textbox', { name: label })
          expect(secret).toHaveValue('')
          expect(secret).toHaveAttribute('placeholder', configuredSecretPlaceholder)
          expect(secret).not.toBeRequired()
          expect(secret).toHaveAttribute('autocomplete', 'off')
        }

        const edits = {
          arize: ['app.tracing.configProvider.project', 'project', 'new-project'],
          phoenix: ['app.tracing.configProvider.project', 'project', 'new-project'],
          langsmith: ['app.tracing.configProvider.project', 'project', 'new-project'],
          // Every other Langfuse field is a secret or a destination.
          langfuse: ['Host', 'host', 'https://cloud.langfuse.com/'],
          opik: ['Workspace', 'workspace', 'new-workspace'],
          weave: ['Entity', 'entity', 'new-entity'],
          aliyun: ['App Name', 'app_name', 'new-app'],
          mlflow: ['app.tracing.configProvider.experimentId', 'experiment_id', '456'],
          databricks: ['app.tracing.configProvider.experimentId', 'experiment_id', '456'],
          tencent: ['Service Name', 'service_name', 'new-service'],
        } satisfies Record<ConfigurableTracingProvider, [string, string, string]>
        const [label, key, value] = edits[provider]
        const input = screen.getByRole('textbox', { name: label })
        await user.clear(input)
        await user.type(input, value)
        await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

        await waitFor(() => expect(callbacks.onSaved).toHaveBeenCalledOnce())
        await expectRequest('PATCH', {
          tracing_provider: provider,
          tracing_config: { ...withoutSecrets(provider, validConfigs[provider]), [key]: value },
        })
      },
    )

    it('sends a newly entered secret and keeps the other saved secret', async () => {
      const user = userEvent.setup()
      const callbacks = renderProviderConfigModal({
        type: 'langfuse',
        config: savedConfig('langfuse', validConfigs.langfuse),
      })

      await user.type(
        screen.getByRole('textbox', { name: 'app.tracing.configProvider.secretKey' }),
        'rotated-secret-key',
      )
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

      await waitFor(() => expect(callbacks.onSaved).toHaveBeenCalledOnce())
      await expectRequest('PATCH', {
        tracing_provider: 'langfuse',
        tracing_config: { host: validConfigs.langfuse.host, secret_key: 'rotated-secret-key' },
      })
    })

    it('requires the saved secrets again once the destination changes', async () => {
      const user = userEvent.setup()
      const callbacks = renderProviderConfigModal({
        type: 'langfuse',
        config: savedConfig('langfuse', validConfigs.langfuse),
      })
      const secretKey = screen.getByRole<HTMLInputElement>('textbox', {
        name: 'app.tracing.configProvider.secretKey',
      })
      const publicKey = screen.getByRole<HTMLInputElement>('textbox', {
        name: 'app.tracing.configProvider.publicKey',
      })
      expect(secretKey).not.toBeRequired()

      const host = screen.getByRole('textbox', { name: 'Host' })
      await user.clear(host)
      await user.type(host, 'https://us.cloud.langfuse.com')

      for (const [secret, label] of [
        [secretKey, 'app.tracing.configProvider.secretKey'],
        [publicKey, 'app.tracing.configProvider.publicKey'],
      ] as const) {
        expect(secret).toBeRequired()
        expect(secret.labels?.[0]).toHaveTextContent(`${label}*`)
        expect(secret).toHaveAttribute(
          'placeholder',
          `app.tracing.configProvider.placeholder:{"key":"${label}"}`,
        )
      }
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

      expect(request).not.toHaveBeenCalled()
      expect(secretKey).toBeInvalid()
      expect(secretKey).toHaveFocus()

      await user.type(secretKey, 'us-secret-key')
      await user.type(publicKey, 'us-public-key')
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

      await waitFor(() => expect(callbacks.onSaved).toHaveBeenCalledOnce())
      await expectRequest('PATCH', {
        tracing_provider: 'langfuse',
        tracing_config: {
          host: 'https://us.cloud.langfuse.com',
          secret_key: 'us-secret-key',
          public_key: 'us-public-key',
        },
      })
    })

    it('keeps blank secrets while the destination is unchanged, even with an added trailing slash', async () => {
      const user = userEvent.setup()
      const callbacks = renderProviderConfigModal({
        type: 'langfuse',
        config: savedConfig('langfuse', validConfigs.langfuse),
      })
      const secrets = Object.values(secretLabels.langfuse).map((label) =>
        screen.getByRole('textbox', { name: label }),
      )
      const expectSavedSecretsKept = () => {
        for (const secret of secrets) {
          expect(secret).not.toBeRequired()
          expect(secret).toHaveAttribute('placeholder', configuredSecretPlaceholder)
        }
      }
      expectSavedSecretsKept()

      const host = screen.getByRole('textbox', { name: 'Host' })
      await user.clear(host)
      await user.type(host, 'https://us.cloud.langfuse.com')
      for (const secret of secrets) expect(secret).toBeRequired()
      await user.clear(host)
      await user.type(host, `${validConfigs.langfuse.host}/`)
      expectSavedSecretsKept()
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

      await waitFor(() => expect(callbacks.onSaved).toHaveBeenCalledOnce())
      await expectRequest('PATCH', {
        tracing_provider: 'langfuse',
        tracing_config: { host: `${validConfigs.langfuse.host}/` },
      })
    })

    it.each([
      ['langfuse', 'host', 'HTTPS://cloud.langfuse.com'],
      ['langsmith', 'endpoint', 'HTTPS://api.smith.langchain.com'],
      ['opik', 'url', 'HTTPS://www.comet.com/opik/api/'],
    ] as const)('accepts case-insensitive URL schemes for %s', async (provider, key, value) => {
      const user = userEvent.setup()
      const values = { ...validConfigs[provider], [key]: value }
      const callbacks = renderProviderConfigModal({
        type: provider,
        config: savedConfig(provider, values),
      })

      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

      await waitFor(() => expect(callbacks.onSaved).toHaveBeenCalledOnce())
      await expectRequest('PATCH', {
        tracing_provider: provider,
        tracing_config: withoutSecrets(provider, values),
      })
    })

    it('displays nullable provider fields as empty without changing their submitted values', async () => {
      const user = userEvent.setup()
      const values = { ...validConfigs.mlflow, username: null }
      const callbacks = renderProviderConfigModal({
        type: 'mlflow',
        config: savedConfig('mlflow', values),
      })

      expect(
        screen.getByRole('textbox', { name: 'app.tracing.configProvider.username' }),
      ).toHaveValue('')
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

      await waitFor(() => expect(callbacks.onSaved).toHaveBeenCalledOnce())
      await expectRequest('PATCH', {
        tracing_provider: 'mlflow',
        tracing_config: withoutSecrets('mlflow', values),
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
        config: savedConfig('langfuse', validConfigs.langfuse),
      })
      const host = screen.getByRole('textbox', { name: 'Host' })
      await user.clear(host)
      await user.type(host, 'https://draft.langfuse.com')
      // A new destination needs its secrets entered again.
      for (const label of Object.values(secretLabels.langfuse))
        await user.type(screen.getByRole('textbox', { name: label }), 'draft-key')
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
      ['langfuse', 'host', 'Host', 'ftp://cloud.langfuse.com', 'https://us.cloud.langfuse.com'],
      [
        'langsmith',
        'endpoint',
        'Endpoint',
        'http://api.smith.langchain.com',
        'https://eu.api.smith.langchain.com',
      ],
      ['weave', 'endpoint', 'Endpoint', 'http://trace.wandb.ai', 'https://weave.example.com'],
      ['opik', 'url', 'Url', 'https://www.comet.com/opik/', 'https://opik.example.com/api/'],
    ] as const)(
      'validates a new %s %s inline before sending the re-entered secrets',
      async (provider, key, label, invalid, valid) => {
        const user = userEvent.setup()
        const callbacks = renderProviderConfigModal({
          type: provider,
          config: savedConfig(provider, validConfigs[provider]),
        })
        const field = screen.getByRole('textbox', { name: label })
        await user.clear(field)
        await user.type(field, invalid)
        const reentered: TraceConfigPayload['tracing_config'] = {}
        for (const [name, secretLabel] of Object.entries(secretLabels[provider])) {
          reentered[name] = `new-${name}`
          await user.type(screen.getByRole('textbox', { name: secretLabel }), `new-${name}`)
        }
        await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

        expect(request).not.toHaveBeenCalled()
        expect(field).toBeInvalid()
        expect(field).toHaveFocus()
        expect(field).toHaveAccessibleDescription()

        await user.clear(field)
        await user.type(field, valid)
        await user.keyboard('{Enter}')

        await waitFor(() => expect(callbacks.onSaved).toHaveBeenCalledOnce())
        expect(field).toBeValid()
        await expectRequest('PATCH', {
          tracing_provider: provider,
          tracing_config: {
            ...withoutSecrets(provider, validConfigs[provider]),
            [key]: valid,
            ...reentered,
          },
        })
      },
    )

    it.each([
      ['mlflow', '1.5'],
      ['databricks', '-1'],
    ] as const)('validates the %s experiment ID inline before sending', async (provider, value) => {
      const user = userEvent.setup()
      const callbacks = renderProviderConfigModal({
        type: provider,
        config: savedConfig(provider, validConfigs[provider]),
      })
      const field = screen.getByRole('textbox', { name: 'app.tracing.configProvider.experimentId' })
      await user.clear(field)
      await user.type(field, value)
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

      expect(request).not.toHaveBeenCalled()
      expect(field).toBeInvalid()
      expect(field).toHaveFocus()
      expect(field).toHaveAccessibleDescription()

      await user.clear(field)
      await user.type(field, '456')
      await user.keyboard('{Enter}')

      await waitFor(() => expect(callbacks.onSaved).toHaveBeenCalledOnce())
      expect(field).toBeValid()
      await expectRequest('PATCH', {
        tracing_provider: provider,
        tracing_config: {
          ...withoutSecrets(provider, validConfigs[provider]),
          experiment_id: '456',
        },
      })
    })

    it.each([
      ['aliyun', 'license_key', 'License Key'],
      ['tencent', 'token', 'Token'],
    ] as const)(
      'rejects a whitespace-only replacement for the saved %s %s',
      async (provider, key, label) => {
        const user = userEvent.setup()
        const callbacks = renderProviderConfigModal({
          type: provider,
          config: savedConfig(provider, validConfigs[provider]),
        })
        const field = screen.getByRole('textbox', { name: label })
        await user.type(field, '   ')
        await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

        expect(request).not.toHaveBeenCalled()
        expect(field).toBeInvalid()
        expect(field).toHaveFocus()
        expect(field).toHaveAccessibleDescription()

        await user.clear(field)
        await user.type(field, 'replacement-secret')
        await user.keyboard('{Enter}')

        await waitFor(() => expect(callbacks.onSaved).toHaveBeenCalledOnce())
        expect(field).toBeValid()
        await expectRequest('PATCH', {
          tracing_provider: provider,
          tracing_config: {
            ...withoutSecrets(provider, validConfigs[provider]),
            [key]: 'replacement-secret',
          },
        })
      },
    )

    it.each(invalidConfigCases)(
      'should reject $provider config when $missingField is missing',
      async ({ provider, values, missingField }) => {
        const user = userEvent.setup()
        renderProviderConfigModal({
          type: provider,
          config: savedConfig(provider, values),
        })

        await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

        expect(request).not.toHaveBeenCalled()
        const field = screen.getByRole('textbox', { name: missingField })
        expect(field).toBeInvalid()
        expect(field).toHaveFocus()
        expect(field).toHaveAccessibleDescription()
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

    it('should remove an existing provider after confirmation', async () => {
      const user = userEvent.setup()
      const callbacks = renderProviderConfigModal({
        type: 'langfuse',
        config: savedConfig('langfuse', validConfigs.langfuse),
      })

      await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))
      expect(
        screen.getByText(
          'app.tracing.configProvider.removeConfirmTitle:{"key":"app.tracing.langfuse.title"}',
        ),
      ).toBeInTheDocument()

      await user.click(
        within(screen.getByRole('alertdialog')).getByRole('button', {
          name: 'common.operation.remove',
        }),
      )

      await waitFor(() => expect(callbacks.onRemoved).toHaveBeenCalledOnce())
      await expectRequest('DELETE')
    })

    it.each([
      [true, 'removeConfirmContentInUse'],
      [false, 'removeConfirmContentNotInUse'],
    ])('describes the removal consequence when in use is %s', async (inUse, key) => {
      const user = userEvent.setup()
      renderProviderConfigModal({
        type: 'langfuse',
        config: savedConfig('langfuse', validConfigs.langfuse),
        inUse,
      })

      await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))

      expect(
        within(screen.getByRole('alertdialog')).getByText(
          `app.tracing.configProvider.${key}:{"key":"app.tracing.langfuse.title"}`,
        ),
      ).toBeInTheDocument()
    })

    it('clears a removal error on reopening while preserving the provider draft', async () => {
      request.mockRejectedValueOnce(
        await httpErrorFromResponse(Response.json({ message: 'Removal failed' }, { status: 400 })),
      )
      const user = userEvent.setup()
      renderProviderConfigModal({ payload: validConfigs.langfuse })
      const host = screen.getByRole('textbox', { name: 'Host' })
      await user.clear(host)
      await user.type(host, 'https://draft.langfuse.com')
      await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))
      await user.click(
        within(screen.getByRole('alertdialog')).getByRole('button', {
          name: 'common.operation.remove',
        }),
      )
      expect(await screen.findByRole('alert')).toHaveTextContent('Removal failed')
      await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())

      expect(host).toHaveValue('https://draft.langfuse.com')
      await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))
      expect(within(screen.getByRole('alertdialog')).queryByRole('alert')).not.toBeInTheDocument()
      expect(request).toHaveBeenCalledOnce()
    })

    it('keeps the draft and returns focus to Remove when confirmation is canceled', async () => {
      const user = userEvent.setup()
      renderProviderConfigModal({
        type: 'langfuse',
        config: savedConfig('langfuse', validConfigs.langfuse),
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

it.each(['app', 'agent'] as const)(
  'validates Tencent service names at the shared %s configuration boundary',
  async (kind) => {
    request.mockImplementation(async () => Response.json({ result: 'success' }))
    const user = userEvent.setup()
    renderProviderConfigModal({
      type: 'tencent',
      resource:
        kind === 'agent'
          ? { kind, agentId: 'agent-1' }
          : { kind, appId: 'app-1', mode: 'workflow' },
    })
    const endpoint = screen.getByRole('textbox', { name: 'Endpoint' })
    const service = screen.getByRole('textbox', { name: 'Service Name' })
    expect(endpoint).toHaveAttribute('placeholder', 'https://ap-guangzhou.apm.tencentcs.com:4320')
    expect(endpoint).toHaveValue('')
    expect(endpoint).toHaveAccessibleDescription('app.tracing.tencent.endpointHelp')
    expect(service).toHaveAccessibleDescription('app.tracing.tencent.serviceNameHelp')
    await user.type(screen.getByRole('textbox', { name: 'Token' }), 'synthetic-token')
    await user.type(endpoint, 'https://ap-guangzhou.apm.tencentcs.com:4320')
    await user.type(service, 'dify_app')
    await user.click(screen.getByRole('button', { name: 'common.operation.saveAndEnable' }))
    expect(request).not.toHaveBeenCalled()
    expect(service).toHaveAttribute('aria-invalid', 'true')
    await user.clear(service)
    await user.type(service, 'dify-app')
    await user.click(screen.getByRole('button', { name: 'common.operation.saveAndEnable' }))
    await waitFor(() => expect(request).toHaveBeenCalledOnce())
    await expectRequest(
      'POST',
      {
        tracing_provider: 'tencent',
        activate: true,
        tracing_config: {
          token: 'synthetic-token',
          endpoint: 'https://ap-guangzhou.apm.tencentcs.com:4320',
          service_name: 'dify-app',
        },
      },
      kind === 'agent' ? '/agent/agent-1/trace-config' : '/apps/app-1/trace-config',
    )
  },
)
