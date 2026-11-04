import type { ComponentProps } from 'react'
import type { ModelItem } from '../../declarations'
import { zModelCredentialResponse } from '@dify/contracts/api/console/workspaces/zod.gen'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { AppToaster } from '@/app/notifications/app-toaster'
import { ModalContextProvider } from '@/context/modal-context-provider'
import {
  createProviderResponseFixture,
  createProviderSummaryFixture,
} from '@/test/console/model-provider'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { ConfigurationMethodEnum, ModelStatusEnum, ModelTypeEnum } from '../../declarations'
import { modelProviderDetailsQueryOptions } from '../../utils'
import ModelList from '../model-list'

export const providerResponse = createProviderResponseFixture({
  provider: 'test-provider',
  configurate_methods: ['customizable-model'],
  custom_configuration: { custom_models: [] },
})
export const provider = modelProviderDetailsQueryOptions().select!({ data: [providerResponse] })
  .data[0]!
export const summaryProvider = createProviderSummaryFixture({
  provider: provider.provider,
  configurate_methods: ['customizable-model'],
})
export const credentials = zModelCredentialResponse.parse({
  credentials: {},
  load_balancing: { enabled: false, configs: [] },
  current_credential_id: 'key-1',
  current_credential_name: 'Default key',
  available_credentials: [{ credential_id: 'key-1', credential_name: 'Default key' }],
})
const models: ModelItem[] = ['gpt-4', 'gpt-3.5'].map((model) => ({
  model,
  label: { en_US: model, zh_Hans: model },
  model_type: ModelTypeEnum.textGeneration,
  fetch_from: ConfigurationMethodEnum.predefinedModel,
  status: ModelStatusEnum.active,
  model_properties: {},
  load_balancing_enabled: false,
}))
export const dialogName = 'modelProvider.modelProvider.auth.configModel'
export function renderModelList({
  currentProvider = provider,
  permissions = ['plugin.model_config', 'credential.manage', 'credential.use'],
}: {
  currentProvider?: ComponentProps<typeof ModelList>['provider']
  permissions?: string[]
} = {}) {
  const onChange = vi.fn()
  const onCollapse = vi.fn()
  const rendered = renderWithConsoleQuery(
    <NuqsTestingAdapter>
      <ModalContextProvider>
        <ModelList
          provider={currentProvider}
          models={models}
          onCollapse={onCollapse}
          onChange={onChange}
        />
        <AppToaster timeout={0} />
      </ModalContextProvider>
    </NuqsTestingAdapter>,
    { features: { model_load_balancing_enabled: true }, workspacePermissionKeys: permissions },
  )
  return { ...rendered, user: userEvent.setup(), onChange, onCollapse }
}
