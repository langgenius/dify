import type {
  CredentialFormSchema,
  ModelLoadBalancingConfig,
  ModelProvider,
} from '../../declarations'
import type { consoleClient } from '@/service/console'
import { zModelCredentialResponse } from '@dify/contracts/api/console/workspaces/zod.gen'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ModalContextProvider } from '@/context/modal-context-provider'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import {
  ConfigurationMethodEnum,
  CurrentSystemQuotaTypeEnum,
  CustomConfigurationStatusEnum,
  FormTypeEnum,
  ModelTypeEnum,
  PreferredProviderTypeEnum,
} from '../../declarations'
import ModelLoadBalancingConfigs from '../model-load-balancing-configs'

const api = vi.hoisted(() => ({
  provider:
    vi.fn<typeof consoleClient.workspaces.current.modelProviders.byProvider.credentials.post>(),
  model:
    vi.fn<
      typeof consoleClient.workspaces.current.modelProviders.byProvider.models.credentials.post
    >(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.modelProviders.byProvider.credentials.post': api.provider,
      'workspaces.current.modelProviders.byProvider.models.credentials.post': api.model,
    }),
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.modelProviders.byProvider.models.credentials.get': async () =>
        zModelCredentialResponse.parse({
          credentials: {},
          available_credentials: [],
          load_balancing: { enabled: false, configs: [] },
        }),
    }),
  }
})

const i18n = (value: string) => ({ en_US: value, zh_Hans: value })
const credentialSchema: CredentialFormSchema = {
  name: 'api_key',
  type: FormTypeEnum.secretInput,
  variable: 'api_key',
  label: i18n('API Key'),
  placeholder: i18n('Enter API key'),
  required: true,
  show_on: [],
}
const provider: ModelProvider = {
  provider: 'test-provider',
  label: i18n('Test provider'),
  icon_small: i18n(''),
  help: { title: i18n(''), url: i18n('') },
  supported_model_types: [ModelTypeEnum.textGeneration],
  configurate_methods: [
    ConfigurationMethodEnum.predefinedModel,
    ConfigurationMethodEnum.customizableModel,
  ],
  provider_credential_schema: { credential_form_schemas: [credentialSchema] },
  model_credential_schema: {
    model: { label: i18n('Model'), placeholder: i18n('Model name') },
    credential_form_schemas: [credentialSchema],
  },
  preferred_provider_type: PreferredProviderTypeEnum.custom,
  custom_configuration: { status: CustomConfigurationStatusEnum.active },
  system_configuration: {
    enabled: false,
    current_quota_type: CurrentSystemQuotaTypeEnum.trial,
    quota_configurations: [],
  },
  allow_custom_token: true,
}
const model = { model: 'test-model', model_type: ModelTypeEnum.textGeneration }

function CredentialFlow({
  configurationMethod,
  hasExistingCredential,
}: {
  configurationMethod: ConfigurationMethodEnum
  hasExistingCredential: boolean
}) {
  const [draftConfig, setDraftConfig] = useState<ModelLoadBalancingConfig | undefined>({
    enabled: true,
    configs: [],
  })

  return (
    <ModalContextProvider>
      <ModelLoadBalancingConfigs
        provider={provider}
        model={model}
        configurationMethod={configurationMethod}
        currentCustomConfigurationModelFixedFields={{
          __model_name: model.model,
          __model_type: model.model_type,
        }}
        draftConfig={draftConfig}
        setDraftConfig={setDraftConfig}
        modelCredential={{
          credentials: {},
          load_balancing: { enabled: true, configs: [] },
          available_credentials: hasExistingCredential
            ? [{ credential_id: 'existing-credential', credential_name: 'Existing key' }]
            : [],
        }}
      />
    </ModalContextProvider>
  )
}

describe('Saving credentials from load balancing', () => {
  beforeEach(() => {
    api.provider.mockReset().mockResolvedValue({ result: 'success' })
    api.model.mockReset().mockResolvedValue({ result: 'success' })
  })

  it.each([
    { configurationMethod: ConfigurationMethodEnum.predefinedModel, hasExistingCredential: false },
    { configurationMethod: ConfigurationMethodEnum.predefinedModel, hasExistingCredential: true },
    {
      configurationMethod: ConfigurationMethodEnum.customizableModel,
      hasExistingCredential: false,
    },
    { configurationMethod: ConfigurationMethodEnum.customizableModel, hasExistingCredential: true },
  ])(
    'submits $configurationMethod credentials (existing credentials: $hasExistingCredential)',
    async ({ configurationMethod, hasExistingCredential }) => {
      const user = userEvent.setup()
      renderWithConsoleQuery(
        <CredentialFlow
          configurationMethod={configurationMethod}
          hasExistingCredential={hasExistingCredential}
        />,
        {
          features: { model_load_balancing_enabled: true },
          workspacePermissionKeys: ['credential.use', 'credential.create', 'credential.manage'],
        },
      )

      await user.click(
        screen.getByRole('button', { name: 'modelProvider.modelProvider.auth.addCredential' }),
      )
      if (hasExistingCredential) {
        const action =
          configurationMethod === ConfigurationMethodEnum.predefinedModel
            ? 'modelProvider.modelProvider.auth.addApiKey'
            : 'modelProvider.modelProvider.auth.addModelCredential'
        await user.click(await screen.findByText(action))
      }
      const dialog = await screen.findByRole('dialog', {
        name: 'modelProvider.modelProvider.auth.addModelCredential',
      })
      await user.type(within(dialog).getByPlaceholderText('Enter API key'), 'test-api-key')
      await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))

      const create =
        configurationMethod === ConfigurationMethodEnum.predefinedModel ? api.provider : api.model
      const other =
        configurationMethod === ConfigurationMethodEnum.predefinedModel ? api.model : api.provider
      await waitFor(() =>
        expect(create).toHaveBeenCalledExactlyOnceWith({
          params: { provider: provider.provider },
          body: expect.objectContaining({
            credentials: expect.objectContaining({ api_key: 'test-api-key' }),
            model: model.model,
            model_type: model.model_type,
          }),
        }),
      )
      expect(other).not.toHaveBeenCalled()
      await waitFor(() => expect(dialog).not.toBeInTheDocument())
    },
  )
})
