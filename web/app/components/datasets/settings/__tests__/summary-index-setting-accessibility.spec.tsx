import type { ProviderWithModelsResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { screen } from '@testing-library/react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { describe, expect, it } from 'vite-plus/test'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import SummaryIndexSetting from '../summary-index-setting'

const modelProvider = {
  tenant_id: 'test-workspace',
  provider: 'openai',
  icon_small: { en_US: '', zh_Hans: '' },
  label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
  status: 'active',
  models: [
    {
      model: 'gpt-4',
      label: { en_US: 'GPT-4', zh_Hans: 'GPT-4' },
      model_type: 'llm',
      fetch_from: 'predefined-model',
      status: 'active',
      model_properties: {},
      deprecated: false,
      has_invalid_load_balancing_configs: false,
      load_balancing_enabled: false,
    },
  ],
} satisfies ProviderWithModelsResponse

describe.each(['knowledge-base', 'dataset-settings', 'create-document'] as const)(
  'SummaryIndexSetting %s accessible model name',
  (entry) => {
    it.each([
      { selected: true, name: 'datasetSettings.form.summaryModel GPT-4' },
      {
        selected: false,
        name: 'datasetSettings.form.summaryModel plugin.detailPanel.configureModel',
      },
    ])(
      'includes the visible label and current value (selected: $selected)',
      ({ selected, name }) => {
        const queryClient = createConsoleQueryClient()
        queryClient.setQueryData(
          consoleQuery.workspaces.current.modelProviders.summary.get.queryOptions().queryKey,
          {
            data: [
              {
                provider: 'openai',
                plugin_id: 'langgenius/openai',
                label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
                supported_model_types: ['llm'],
                configurate_methods: ['predefined-model'],
                preferred_provider_type: 'custom',
                is_configured: true,
                custom_configuration: {
                  status: 'active',
                  has_custom_models: false,
                  available_credentials: [],
                  current_credential_usable: true,
                },
                system_configuration: { enabled: false },
              },
            ],
            plugins: {},
          },
        )
        queryClient.setQueryData(
          consoleQuery.workspaces.current.modelProviders.credits.get.queryOptions().queryKey,
          {
            remaining_credits: 0,
            is_unlimited: false,
            is_exhausted: true,
            exhausted_at: null,
            next_credit_reset_date: null,
            pool_type: null,
            quota_limit: 0,
            quota_used: 0,
          },
        )
        queryClient.setQueryData(
          consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryOptions({
            input: { params: { model_type: 'llm' } },
          }).queryKey,
          { data: [modelProvider] },
        )

        renderWithConsoleQuery(
          <NuqsTestingAdapter>
            <SummaryIndexSetting
              entry={entry}
              summaryIndexSetting={{
                enable: true,
                ...(selected && { model_provider_name: 'openai', model_name: 'gpt-4' }),
              }}
            />
          </NuqsTestingAdapter>,
          { queryClient },
        )

        expect(screen.getByRole('button', { name })).toBeInTheDocument()
      },
    )
  },
)
