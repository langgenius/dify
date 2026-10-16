import type { AppMcpServerResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { RagPipelineRecommendedPluginsResponse } from '@dify/contracts/api/console/rag/types.gen'
import type {
  ApiProviderDetailResponse,
  ApiSchemaParseResponse,
  ApiToolBundle,
  ToolParameter as ContractToolParameter,
  I18nObject,
  ToolApiEntity,
  ToolApiListResponse,
  ToolProviderApiEntityResponse,
  ToolProviderListResponse,
  WorkflowToolDetailResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { MarketplacePlugin } from '@dify/contracts/marketplace'
import type {
  Collection,
  Credential,
  CustomParamSchema,
  Emoji,
  MCPServerDetail,
  Tool,
  ToolParameter,
  WorkflowToolProviderOutputSchema,
  WorkflowToolProviderResponse,
} from '../types'
import type { RAGRecommendedPlugins, ToolWithProvider } from '@/app/components/workflow/types'
import { AuthHeaderPrefix, AuthType } from '../types'

type LocalizedText = Collection['label']
type ProviderIcon = ToolProviderApiEntityResponse['icon']

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isOneOf = <T extends string>(values: Record<string, T>, value: unknown): value is T =>
  typeof value === 'string' && Object.values<string>(values).includes(value)

const getString = (record: Record<string, unknown>, key: string) => {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

// Untranslated locales fall back to en_US, matching renderI18nObject.
const toLocalizedText = ({ en_US, ja_JP, pt_BR, zh_Hans }: I18nObject): LocalizedText => ({
  en_US,
  zh_Hans: zh_Hans ?? en_US,
  ...(ja_JP != null && { ja_JP }),
  ...(pt_BR != null && { pt_BR }),
})

const EMPTY_TEXT: LocalizedText = { en_US: '', zh_Hans: '' }

// Providers return an icon URL, or an emoji record for API and workflow tools.
const toIcon = (icon: ProviderIcon): string | Emoji =>
  typeof icon === 'string'
    ? icon
    : { background: icon.background ?? '', content: icon.content ?? '' }

const toIdentityMode = (mode: string | undefined) =>
  mode === 'off' || mode === 'idp_token' ? mode : undefined

const toToolParameter = (parameter: ContractToolParameter): ToolParameter => ({
  ...parameter,
  label: toLocalizedText(parameter.label),
  human_description: parameter.human_description
    ? toLocalizedText(parameter.human_description)
    : EMPTY_TEXT,
  llm_description: parameter.llm_description ?? '',
  required: parameter.required ?? false,
  multiple: parameter.multiple ?? false,
  min: parameter.min ?? undefined,
  max: parameter.max ?? undefined,
  options: parameter.options?.map((option) => ({
    ...option,
    label: toLocalizedText(option.label),
  })),
})

const toTool = (tool: ToolApiEntity): Tool => ({
  ...tool,
  label: toLocalizedText(tool.label),
  description: toLocalizedText(tool.description),
  labels: tool.labels ?? [],
  output_schema: tool.output_schema ?? {},
  parameters: (tool.parameters ?? []).map(toToolParameter),
})

const toCollection = (provider: ToolProviderApiEntityResponse): Collection => ({
  ...provider,
  label: toLocalizedText(provider.label),
  description: toLocalizedText(provider.description),
  icon: toIcon(provider.icon),
  icon_dark: provider.icon_dark === undefined ? undefined : toIcon(provider.icon_dark),
  team_credentials: provider.team_credentials ?? {},
  is_team_authorization: provider.is_team_authorization ?? false,
  allow_delete: provider.allow_delete ?? false,
  labels: provider.labels ?? [],
  tools: provider.tools?.map(toTool),
  plugin_id: provider.plugin_id ?? undefined,
  server_url: provider.server_url ?? undefined,
  server_identifier: provider.server_identifier ?? undefined,
  masked_headers: provider.masked_headers ?? undefined,
  authentication: provider.authentication
    ? {
        client_id: provider.authentication.client_id,
        client_secret: provider.authentication.client_secret ?? undefined,
      }
    : undefined,
  configuration: provider.configuration ?? undefined,
  identity_mode: toIdentityMode(provider.identity_mode),
  workflow_app_id: provider.workflow_app_id ?? undefined,
})

export const selectToolProvider = (provider: ToolProviderApiEntityResponse): ToolWithProvider => ({
  ...toCollection(provider),
  tools: (provider.tools ?? []).map(toTool),
  plugin_unique_identifier: provider.plugin_unique_identifier ?? undefined,
})

export const selectToolCollections = (data: ToolProviderListResponse) => data.map(toCollection)

export const selectToolsWithProvider = (data: ToolProviderListResponse) =>
  data.map(selectToolProvider)

export const selectToolProviderTools = (provider: ToolProviderApiEntityResponse) => ({
  tools: (provider.tools ?? []).map(toTool),
})

export const selectBuiltinProviderTools = (data: ToolApiListResponse) => data.map(toTool)

export const selectMCPServerDetail = (detail: AppMcpServerResponse): MCPServerDetail => ({
  ...detail,
  parameters: isRecord(detail.parameters)
    ? Object.fromEntries(
        Object.entries(detail.parameters).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      )
    : undefined,
})

const toOutputSchema = (
  schema: Record<string, unknown> = {},
): WorkflowToolProviderOutputSchema => ({
  type: typeof schema.type === 'string' ? schema.type : 'object',
  properties: isRecord(schema.properties)
    ? Object.fromEntries(
        Object.entries(schema.properties).flatMap(([name, property]) =>
          isRecord(property) && typeof property.type === 'string'
            ? [
                [
                  name,
                  {
                    type: property.type,
                    description:
                      typeof property.description === 'string' ? property.description : '',
                  },
                ],
              ]
            : [],
        ),
      )
    : {},
})

export const selectWorkflowToolDetail = (
  detail: WorkflowToolDetailResponse,
): WorkflowToolProviderResponse => ({
  ...detail,
  privacy_policy: detail.privacy_policy ?? '',
  tool: {
    ...detail.tool,
    label: toLocalizedText(detail.tool.label),
    description: toLocalizedText(detail.tool.description),
    labels: detail.tool.labels ?? [],
    parameters: (detail.tool.parameters ?? []).map(toToolParameter),
    output_schema: toOutputSchema(detail.tool.output_schema),
  },
})

// Uninstalled recommendations are marketplace manifests the console proxies unchanged; keep the
// ones that identify an installable package.
const isMarketplacePlugin = (value: Record<string, unknown>): value is MarketplacePlugin =>
  typeof value.type === 'string' &&
  typeof value.org === 'string' &&
  typeof value.name === 'string' &&
  typeof value.plugin_id === 'string' &&
  typeof value.latest_package_identifier === 'string'

export const selectRAGRecommendedPlugins = (
  data: RagPipelineRecommendedPluginsResponse,
): RAGRecommendedPlugins => ({
  installed_recommended_plugins: data.installed_recommended_plugins.map(selectToolProvider),
  uninstalled_recommended_plugins: data.uninstalled_recommended_plugins.filter(isMarketplacePlugin),
})

// OpenAPI operations without an id or summary leave those labels empty in the editor.
const toCustomParamSchema = (bundle: ApiToolBundle): CustomParamSchema => ({
  operation_id: bundle.operation_id ?? '',
  summary: bundle.summary ?? '',
  server_url: bundle.server_url,
  method: bundle.method,
  parameters: (bundle.parameters ?? []).map(toToolParameter),
})

export const selectApiSchemaParameters = (data: ApiSchemaParseResponse) => ({
  schema_type: data.schema_type,
  parameters_schema: data.parameters_schema.map(toCustomParamSchema),
})

// Stored API tool credentials hold the fields of their auth type. A provider saved without an
// auth type sends no credentials.
const toCredential = (credentials: Record<string, unknown>): Credential => ({
  auth_type: isOneOf(AuthType, credentials.auth_type) ? credentials.auth_type : AuthType.none,
  api_key_header: getString(credentials, 'api_key_header'),
  api_key_value: getString(credentials, 'api_key_value'),
  api_key_header_prefix: isOneOf(AuthHeaderPrefix, credentials.api_key_header_prefix)
    ? credentials.api_key_header_prefix
    : undefined,
  api_key_query_param: getString(credentials, 'api_key_query_param'),
})

/** The custom tool editor state for a stored API provider. */
export const selectCustomCollection = (detail: ApiProviderDetailResponse) => ({
  credentials: toCredential(detail.credentials ?? {}),
  icon: detail.icon,
  schema_type: detail.schema_type,
  schema: detail.schema,
  privacy_policy: detail.privacy_policy ?? '',
  custom_disclaimer: detail.custom_disclaimer ?? '',
  tools: detail.tools.map(toCustomParamSchema),
})
