import type {
  CredentialFormSchema,
  ModelLoadBalancingConfig,
  ModelProvider,
} from '../../declarations'
import type { ModalState, ModelModalType } from '@/context/modal-context'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ModalContext, useModalContext } from '@/context/modal-context'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import {
  ConfigurationMethodEnum,
  CurrentSystemQuotaTypeEnum,
  CustomConfigurationStatusEnum,
  FormTypeEnum,
  ModelTypeEnum,
  PreferredProviderTypeEnum,
} from '../../declarations'
import ModelModal from '../../model-modal'
import ModelLoadBalancingConfigs from '../model-load-balancing-configs'

const { mockPost } = vi.hoisted(() => ({ mockPost: vi.fn() }))

vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  get: vi.fn().mockResolvedValue({ credentials: {} }),
  post: mockPost,
}))

vi.mock('../../hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks')>()),
  useLanguage: () => 'en_US',
  useRefreshModel: () => ({ handleRefreshModel: vi.fn() }),
}))

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

// Keep the credential menu, auth hooks, modal and form real so both forwarding
// boundaries participate in the save request. Only mount the relevant global modal.
function CredentialFlow({
  configurationMethod,
  hasExistingCredential,
}: {
  configurationMethod: ConfigurationMethodEnum
  hasExistingCredential: boolean
}) {
  const modalContext = useModalContext()
  const [modal, setModal] = useState<ModalState<ModelModalType> | null>(null)
  const [draftConfig, setDraftConfig] = useState<ModelLoadBalancingConfig | undefined>({
    enabled: true,
    configs: [],
  })
  const payload = modal?.payload

  return (
    // oxlint-disable-next-line eslint-react/no-context-provider -- use-context-selector exposes a Provider, not a renderable React context.
    <ModalContext.Provider value={{ ...modalContext, setShowModelModal: setModal }}>
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
      {payload && (
        <ModelModal
          provider={payload.currentProvider}
          configurateMethod={payload.currentConfigurationMethod}
          currentCustomConfigurationModelFixedFields={
            payload.currentCustomConfigurationModelFixedFields
          }
          model={payload.model}
          credential={payload.credential}
          isModelCredential={payload.isModelCredential}
          mode={payload.mode}
          onCancel={() => setModal(null)}
          onSave={() => setModal(null)}
          onRemove={() => setModal(null)}
        />
      )}
    </ModalContext.Provider>
  )
}

describe('Saving credentials from load balancing', () => {
  beforeEach(() => {
    mockPost.mockReset()
    mockPost.mockResolvedValue({ result: 'success' })
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
      const dialog = await screen.findByRole('dialog')
      await user.type(within(dialog).getByPlaceholderText('Enter API key'), 'test-api-key')
      await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))

      const endpoint =
        configurationMethod === ConfigurationMethodEnum.predefinedModel
          ? '/workspaces/current/model-providers/test-provider/credentials'
          : '/workspaces/current/model-providers/test-provider/models/credentials'
      await waitFor(() => {
        expect(mockPost).toHaveBeenCalledTimes(1)
        expect(mockPost).toHaveBeenCalledWith(endpoint, {
          body: expect.objectContaining({
            credentials: expect.objectContaining({ api_key: 'test-api-key' }),
            model: model.model,
            model_type: model.model_type,
          }),
        })
      })
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    },
  )
})
