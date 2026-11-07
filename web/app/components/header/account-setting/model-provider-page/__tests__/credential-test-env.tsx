import type { ReactElement } from 'react'
import type { ModelProvider } from '../declarations'
import { renderWithConfigurationModals } from '@/test/configuration-modals'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryClient } from '@/test/console/query-data'
import {
  ConfigurationMethodEnum,
  CurrentSystemQuotaTypeEnum,
  CustomConfigurationStatusEnum,
  FormTypeEnum,
  ModelTypeEnum,
  PreferredProviderTypeEnum,
  QuotaUnitEnum,
} from '../declarations'

const credentialField = {
  name: 'api_key',
  variable: 'api_key',
  label: { en_US: 'API key', zh_Hans: 'API key' },
  type: FormTypeEnum.secretInput,
  required: true,
  show_on: [],
}
const createI18n = (text: string) => ({ en_US: text, zh_Hans: text })

export const createCredentialProvider = (overrides?: Partial<ModelProvider>): ModelProvider => ({
  provider: 'openai',
  label: createI18n('OpenAI'),
  help: {
    title: createI18n('Help'),
    url: createI18n('https://example.com'),
  },
  icon_small: createI18n('icon'),
  supported_model_types: [ModelTypeEnum.textGeneration],
  configurate_methods: [ConfigurationMethodEnum.predefinedModel],
  provider_credential_schema: { credential_form_schemas: [credentialField] },
  model_credential_schema: {
    model: { label: createI18n('Model'), placeholder: createI18n('Model') },
    credential_form_schemas: [credentialField],
  },
  preferred_provider_type: PreferredProviderTypeEnum.system,
  custom_configuration: {
    status: CustomConfigurationStatusEnum.active,
    available_credentials: [],
    custom_models: [],
    can_added_models: [],
  },
  system_configuration: {
    enabled: true,
    current_quota_type: CurrentSystemQuotaTypeEnum.trial,
    quota_configurations: [
      {
        quota_type: CurrentSystemQuotaTypeEnum.trial,
        quota_unit: QuotaUnitEnum.times,
        quota_limit: 0,
        quota_used: 0,
        is_valid: true,
      },
    ],
  },
  allow_custom_token: true,
  ...overrides,
})

export function renderCredentialComponent(
  ui: ReactElement,
  {
    modelCatalog = [],
    ...options
  }: NonNullable<Parameters<typeof renderWithConfigurationModals>[1]> & {
    modelCatalog?: Parameters<typeof seedModelProviderQueries>[1]
  } = {},
) {
  const queryClient = options.queryClient ?? createConsoleQueryClient()
  seedModelProviderQueries(queryClient, modelCatalog)
  return renderWithConfigurationModals(ui, {
    workspacePermissionKeys: ['credential.use', 'credential.create', 'credential.manage'],
    ...options,
    queryClient,
  })
}

export const credential = { credential_id: 'cred-1', credential_name: 'Key 1' }
export const customModel = { model: 'gpt-4', model_type: ModelTypeEnum.textGeneration }
