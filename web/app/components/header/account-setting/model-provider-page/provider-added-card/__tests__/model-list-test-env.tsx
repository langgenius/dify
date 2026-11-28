import type { ComponentProps } from 'react'
import type { ModelItem } from '../../declarations'
import { zModelCredentialResponse } from '@dify/contracts/api/console/workspaces/zod.gen'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { ModelCredentialDialog } from '@/app/components/header/account-setting/model-provider-page/model-modal/dialog'
import { AppToaster } from '@/app/notifications/app-toaster'
import { createErrorToastCaches } from '@/app/query-error-toast'
import {
  createProviderResponseFixture,
  createProviderSummaryFixture,
} from '@/test/console/model-provider'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
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
export const createModel = (
  model: string,
  status: ModelItem['status'] = ModelStatusEnum.active,
): ModelItem => ({
  model,
  label: { en_US: model, zh_Hans: model },
  model_type: ModelTypeEnum.textGeneration,
  fetch_from: ConfigurationMethodEnum.predefinedModel,
  status,
  model_properties: {},
  load_balancing_enabled: false,
})
const defaultModels = ['gpt-4', 'gpt-3.5'].map((model) => createModel(model))
export const dialogName = 'modelProvider.modelProvider.auth.configModel'
export function renderModelList({
  currentProvider = provider,
  errorToasts = false,
  permissions = ['plugin.model_config', 'credential.manage', 'credential.use'],
  models = defaultModels,
}: {
  currentProvider?: ComponentProps<typeof ModelList>['provider']
  /** Mirror the app's cache-level error toasts, so a failure's messages can be counted. */
  errorToasts?: boolean
  permissions?: string[]
  models?: ModelItem[]
} = {}) {
  const onChange = vi.fn()
  const onCollapse = vi.fn()
  const rendered = renderWithConsoleQuery(
    <NuqsTestingAdapter>
      <>
        <ModelList
          provider={currentProvider}
          models={models}
          onCollapse={onCollapse}
          onChange={onChange}
        />
        <AppToaster timeout={0} />
        <ModelCredentialDialog />
      </>
    </NuqsTestingAdapter>,
    {
      features: { model_load_balancing_enabled: true },
      workspacePermissionKeys: permissions,
      ...(errorToasts && {
        queryClient: createConsoleQueryClient({ caches: createErrorToastCaches() }),
      }),
    },
  )
  return { ...rendered, user: userEvent.setup(), onChange, onCollapse }
}
