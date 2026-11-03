import type { LLMNodeType } from '../types'
import { zProviderWithModelsResponse } from '@dify/contracts/api/console/workspaces/zod.gen'
import { screen } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import { createModelCreditsFixture } from '@/test/console/model-provider'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import Node from '../node'

const render = createNuqsTestRenderer(renderWithConsoleQuery)
const provider = zProviderWithModelsResponse.parse({
  tenant_id: 'workspace-1',
  provider: 'openai',
  status: 'active',
  label: { en_US: 'OpenAI' },
  models: [
    {
      model: 'gpt-4o',
      label: { en_US: 'GPT-4o' },
      model_type: 'llm',
      fetch_from: 'predefined-model',
      status: 'active',
      model_properties: {},
      load_balancing_enabled: false,
    },
  ],
})
const createClient = () => {
  const client = createConsoleQueryClient()
  for (const model_type of [
    'llm',
    'moderation',
    'rerank',
    'speech2text',
    'text-embedding',
    'tts',
  ] as const) {
    client.setQueryData(
      consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryKey({
        input: { params: { model_type } },
      }),
      { data: model_type === 'llm' ? [provider] : [] },
    )
  }
  client.setQueryData(consoleQuery.workspaces.current.modelProviders.summary.get.queryKey(), {
    data: [],
    plugins: {},
  })
  client.setQueryData(
    consoleQuery.workspaces.current.modelProviders.credits.get.queryKey(),
    createModelCreditsFixture(),
  )
  return client
}

it('displays a cached environment model without workflow context and hides an unconfigured model', () => {
  const data: LLMNodeType = {
    title: 'LLM',
    desc: '',
    type: BlockEnum.LLM,
    model: { provider: 'openai', name: 'gpt-4o', mode: 'chat', completion_params: {} },
    model_selector: ['env', 'for_summarize'],
    prompt_template: [],
    context: { enabled: false, variable_selector: [] },
    vision: { enabled: false },
  }
  const { rerender } = render(<Node id="llm-node" data={data} />, { queryClient: createClient() })
  expect(screen.getByText('GPT-4o')).toBeInTheDocument()
  rerender(
    <Node id="llm-node" data={{ ...data, model: { ...data.model, provider: '', name: '' } }} />,
  )
  expect(screen.queryByText('GPT-4o')).not.toBeInTheDocument()
})
