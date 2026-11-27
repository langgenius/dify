import type { ProviderWithModelsResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ComponentProps } from 'react'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { useState } from 'react'
import { describe, expect, it } from 'vite-plus/test'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { apiError } from '@/test/fake-api'
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

const listModels = vi.hoisted(() => vi.fn())
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.models.modelTypes.byModelType.get': listModels,
    }),
  }
})

type Props = ComponentProps<typeof SummaryIndexSetting>
const renderSettings = (props: Props, { seedModels = true } = {}) => {
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
  if (seedModels)
    queryClient.setQueryData(
      consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryOptions({
        input: { params: { model_type: 'llm' } },
      }).queryKey,
      { data: [modelProvider] },
    )
  for (const model_type of ['text-embedding', 'rerank', 'speech2text', 'tts'] as const) {
    queryClient.setQueryData(
      consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryKey({
        input: { params: { model_type } },
      }),
      { data: [] },
    )
  }
  const onChange = vi.fn()
  const Harness = () => {
    const [setting, setSetting] = useState(props.summaryIndexSetting)
    return (
      <SummaryIndexSetting
        {...props}
        summaryIndexSetting={setting}
        onSummaryIndexSettingChange={(update) => {
          onChange(update)
          setSetting((current) => ({ ...current, ...update }))
        }}
      />
    )
  }
  return {
    onChange,
    ...renderWithConsoleQuery(
      <NuqsTestingAdapter>
        <Harness />
      </NuqsTestingAdapter>,
      { queryClient },
    ),
  }
}

describe.each(['knowledge-base', 'dataset-settings', 'create-document'] as const)(
  'summary settings: %s',
  (entry) => {
    it('shows a failed model catalog load with a retry next to the summary model', async () => {
      const user = userEvent.setup()
      listModels
        .mockReset()
        .mockRejectedValueOnce(apiError({ status: 503, message: 'Models unavailable' }))
        .mockResolvedValue({ data: [modelProvider] })
      renderSettings({ entry, summaryIndexSetting: { enable: true } }, { seedModels: false })

      expect(await screen.findByRole('alert')).toHaveTextContent('dataset.loadError')
      await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
      expect(listModels).toHaveBeenCalledTimes(2)
    })

    it('enables summaries and saves the chosen model and instructions', async () => {
      const user = userEvent.setup()
      const { onChange } = renderSettings({ entry, summaryIndexSetting: { enable: false } })
      const toggle = screen.getByRole('switch', { name: 'datasetSettings.form.summaryAutoGen' })
      expect(
        screen.queryByRole('textbox', { name: 'datasetSettings.form.summaryInstructions' }),
      ).not.toBeInTheDocument()
      await user.click(toggle)
      expect(onChange).toHaveBeenLastCalledWith({ enable: true })
      await user.click(
        screen.getByRole('button', {
          name: 'datasetSettings.form.summaryModel plugin.detailPanel.configureModel',
        }),
      )
      const picker = await screen.findByRole('dialog', {
        name: 'plugin.detailPanel.configureModel',
      })
      await user.click(within(picker).getByText('GPT-4'))
      expect(onChange).toHaveBeenLastCalledWith({
        model_provider_name: 'openai',
        model_name: 'gpt-4',
      })
      expect(
        screen.getByRole('button', { name: 'datasetSettings.form.summaryModel GPT-4' }),
      ).toBeInTheDocument()
      await user.type(
        screen.getByRole('textbox', { name: 'datasetSettings.form.summaryInstructions' }),
        'Summary',
      )
      expect(onChange).toHaveBeenLastCalledWith({ summary_prompt: 'Summary' })
    })

    it('prevents editing summary settings without permission', async () => {
      const user = userEvent.setup()
      const { onChange } = renderSettings({
        entry,
        readonly: true,
        summaryIndexSetting: {
          enable: true,
          model_provider_name: 'openai',
          model_name: 'gpt-4',
          summary_prompt: 'Keep this',
        },
      })
      const toggle = screen.getByRole('switch', { name: 'datasetSettings.form.summaryAutoGen' })
      const model = screen.getByRole('button', { name: 'datasetSettings.form.summaryModel GPT-4' })
      const prompt = screen.getByRole('textbox', {
        name: 'datasetSettings.form.summaryInstructions',
      })
      expect(toggle).toHaveAttribute('aria-disabled', 'true')
      expect(model).toBeDisabled()
      expect(prompt).toBeDisabled()
      await user.click(toggle)
      await user.click(model)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(onChange).not.toHaveBeenCalled()
    })
  },
)
