import type { TraceConfigPayload } from '@dify/contracts/api/console/apps/types.gen'

type FieldLabelKey = `tracing.configProvider.${
  | 'clientId'
  | 'clientSecret'
  | 'databricksHost'
  | 'experimentId'
  | 'password'
  | 'personalAccessToken'
  | 'project'
  | 'publicKey'
  | 'secretKey'
  | 'trackingUri'
  | 'username'}`

/** One input of a provider form; it submits the `tracing_config` entry named `name`. */
export type TracingProviderField = {
  name: string
  /** Product terms such as "API Key" are shown as written; other labels are translated. */
  label: string | { key: FieldLabelKey }
  required: boolean
  /**
   * Declared with `secret()` in the provider's backend config: the API never returns it, and a
   * secret left out of a save keeps its saved value while no destination changes.
   */
  secret: boolean
  /**
   * Declared with `destination()` in the provider's backend config: it names where the secrets
   * are sent, so changing it means the secrets must be entered again.
   */
  destination: boolean
  /** An example value; without one, the placeholder asks for the label. */
  placeholder?: string
  description?: 'tracing.tencent.endpointHelp' | 'tracing.tencent.serviceNameHelp'
  type?: 'url'
  inputMode?: 'numeric'
  pattern?: string
  maxLength?: number
}

const httpUrlPattern = '[Hh][Tt][Tt][Pp][Ss]?://.+'
const httpsUrlPattern = '[Hh][Tt][Tt][Pp][Ss]://.+'
const nonBlankPattern = String.raw`.*\S.*`
const integerPattern = String.raw`\s*[0-9]+\s*`

export const tracingProviders = {
  langfuse: {
    docUrl: 'https://docs.langfuse.com',
    iconWidth: 'w-18.5',
    panelIconWidth: 'w-27.75',
    fields: [
      {
        name: 'secret_key',
        label: { key: 'tracing.configProvider.secretKey' },
        required: true,
        secret: true,
        destination: false,
      },
      {
        name: 'public_key',
        label: { key: 'tracing.configProvider.publicKey' },
        required: true,
        secret: true,
        destination: false,
      },
      {
        name: 'host',
        label: 'Host',
        required: true,
        secret: false,
        destination: true,
        type: 'url',
        pattern: httpUrlPattern,
        placeholder: 'https://cloud.langfuse.com',
      },
    ],
  },
  langsmith: {
    docUrl: 'https://docs.smith.langchain.com/',
    iconWidth: 'w-21',
    panelIconWidth: 'w-31',
    fields: [
      { name: 'api_key', label: 'API Key', required: true, secret: true, destination: false },
      {
        name: 'project',
        label: { key: 'tracing.configProvider.project' },
        required: true,
        secret: false,
        destination: false,
      },
      {
        name: 'endpoint',
        label: 'Endpoint',
        required: false,
        secret: false,
        destination: true,
        type: 'url',
        pattern: httpsUrlPattern,
        placeholder: 'https://api.smith.langchain.com',
      },
    ],
  },
  opik: {
    docUrl: 'https://www.comet.com/docs/opik/integrations/dify',
    iconWidth: 'w-[47.133904px]',
    panelIconWidth: 'w-[70.700851px]',
    fields: [
      { name: 'api_key', label: 'API Key', required: false, secret: true, destination: false },
      {
        name: 'project',
        label: { key: 'tracing.configProvider.project' },
        required: false,
        secret: false,
        destination: false,
      },
      {
        name: 'workspace',
        label: 'Workspace',
        required: false,
        secret: false,
        destination: false,
        placeholder: 'default',
      },
      {
        name: 'url',
        label: 'Url',
        required: false,
        secret: false,
        destination: true,
        type: 'url',
        pattern: '[Hh][Tt][Tt][Pp][Ss]?://.*/api/',
        placeholder: 'https://www.comet.com/opik/api/',
      },
    ],
  },
  mlflow: {
    docUrl: 'https://mlflow.org/docs/latest/genai/',
    iconWidth: 'w-11',
    panelIconWidth: 'w-16.25',
    fields: [
      {
        name: 'tracking_uri',
        label: { key: 'tracing.configProvider.trackingUri' },
        required: true,
        secret: false,
        destination: true,
        type: 'url',
        pattern: httpUrlPattern,
        placeholder: 'http://localhost:5000',
      },
      {
        name: 'experiment_id',
        label: { key: 'tracing.configProvider.experimentId' },
        required: true,
        secret: false,
        destination: false,
        inputMode: 'numeric',
        pattern: integerPattern,
      },
      {
        name: 'username',
        label: { key: 'tracing.configProvider.username' },
        required: false,
        secret: false,
        destination: false,
      },
      {
        name: 'password',
        label: { key: 'tracing.configProvider.password' },
        required: false,
        secret: true,
        destination: false,
      },
    ],
  },
  databricks: {
    docUrl: 'https://docs.databricks.com/aws/en/mlflow3/genai/tracing/',
    iconWidth: 'w-25',
    panelIconWidth: 'w-37.5',
    fields: [
      {
        name: 'experiment_id',
        label: { key: 'tracing.configProvider.experimentId' },
        required: true,
        secret: false,
        destination: false,
        inputMode: 'numeric',
        pattern: integerPattern,
      },
      {
        name: 'host',
        label: { key: 'tracing.configProvider.databricksHost' },
        required: true,
        secret: false,
        destination: true,
        type: 'url',
        pattern: httpUrlPattern,
      },
      {
        name: 'client_id',
        label: { key: 'tracing.configProvider.clientId' },
        required: false,
        secret: false,
        destination: false,
      },
      {
        name: 'client_secret',
        label: { key: 'tracing.configProvider.clientSecret' },
        required: false,
        secret: true,
        destination: false,
      },
      {
        name: 'personal_access_token',
        label: { key: 'tracing.configProvider.personalAccessToken' },
        required: false,
        secret: true,
        destination: false,
      },
    ],
  },
  weave: {
    docUrl: 'https://weave-docs.wandb.ai/',
    iconWidth: 'w-30',
    panelIconWidth: 'w-31',
    fields: [
      { name: 'api_key', label: 'API Key', required: true, secret: true, destination: false },
      {
        name: 'project',
        label: { key: 'tracing.configProvider.project' },
        required: true,
        secret: false,
        destination: false,
      },
      { name: 'entity', label: 'Entity', required: false, secret: false, destination: false },
      {
        name: 'endpoint',
        label: 'Endpoint',
        required: false,
        secret: false,
        destination: true,
        type: 'url',
        pattern: httpsUrlPattern,
        placeholder: 'https://trace.wandb.ai/',
      },
      {
        name: 'host',
        label: 'Host',
        required: false,
        secret: false,
        destination: true,
        type: 'url',
        pattern: httpUrlPattern,
        placeholder: 'https://api.wandb.ai',
      },
    ],
  },
  arize: {
    docUrl: 'https://docs.arize.com/arize',
    iconWidth: 'w-18.5',
    panelIconWidth: 'w-27.75',
    fields: [
      { name: 'api_key', label: 'API Key', required: true, secret: true, destination: false },
      { name: 'space_id', label: 'Space ID', required: true, secret: true, destination: false },
      {
        name: 'project',
        label: { key: 'tracing.configProvider.project' },
        required: true,
        secret: false,
        destination: false,
      },
      {
        name: 'endpoint',
        label: 'Endpoint',
        required: false,
        secret: false,
        destination: true,
        type: 'url',
        pattern: httpUrlPattern,
        placeholder: 'https://otlp.arize.com',
      },
    ],
  },
  phoenix: {
    docUrl: 'https://docs.arize.com/phoenix',
    iconWidth: 'w-18.5',
    panelIconWidth: 'w-27.75',
    fields: [
      { name: 'api_key', label: 'API Key', required: false, secret: true, destination: false },
      {
        name: 'project',
        label: { key: 'tracing.configProvider.project' },
        required: true,
        secret: false,
        destination: false,
      },
      {
        name: 'endpoint',
        label: 'Endpoint',
        required: false,
        secret: false,
        destination: true,
        type: 'url',
        pattern: httpUrlPattern,
        placeholder: 'https://app.phoenix.arize.com',
      },
    ],
  },
  aliyun: {
    docUrl: 'https://help.aliyun.com/zh/arms/tracing-analysis/untitled-document-1750672984680',
    iconWidth: 'w-16.25',
    panelIconWidth: 'w-24',
    fields: [
      {
        name: 'license_key',
        label: 'License Key',
        required: true,
        secret: true,
        destination: false,
        pattern: nonBlankPattern,
      },
      {
        name: 'endpoint',
        label: 'Endpoint',
        required: true,
        secret: false,
        destination: true,
        type: 'url',
        pattern: httpUrlPattern,
        placeholder: 'https://tracing.arms.aliyuncs.com',
      },
      { name: 'app_name', label: 'App Name', required: true, secret: false, destination: false },
    ],
  },
  tencent: {
    docUrl: 'https://cloud.tencent.com/document/product/248/116531',
    iconWidth: 'w-20',
    panelIconWidth: 'w-30',
    fields: [
      {
        name: 'token',
        label: 'Token',
        required: true,
        secret: true,
        destination: false,
        pattern: nonBlankPattern,
      },
      {
        name: 'endpoint',
        label: 'Endpoint',
        required: true,
        secret: false,
        destination: true,
        type: 'url',
        pattern: httpUrlPattern,
        placeholder: 'https://ap-guangzhou.apm.tencentcs.com:4320',
        description: 'tracing.tencent.endpointHelp',
      },
      {
        name: 'service_name',
        label: 'Service Name',
        required: true,
        secret: false,
        destination: false,
        maxLength: 63,
        pattern: String.raw`[a-z]([a-z0-9\-]*[a-z0-9])?`,
        placeholder: 'dify-app',
        description: 'tracing.tencent.serviceNameHelp',
      },
    ],
  },
} as const satisfies Partial<
  Record<
    TraceConfigPayload['tracing_provider'],
    {
      docUrl: string
      /** Width utility for the logo; the logo itself comes from `provider-icons.module.css`. */
      iconWidth: string
      panelIconWidth: string
      fields: readonly TracingProviderField[]
    }
  >
>

export type ConfigurableTracingProvider = keyof typeof tracingProviders

export function hasProviderForm(
  provider: TraceConfigPayload['tracing_provider'] | null | undefined,
): provider is ConfigurableTracingProvider {
  return provider != null && Object.hasOwn(tracingProviders, provider)
}

export const configurableProviders = Object.keys(tracingProviders).filter(hasProviderForm)
