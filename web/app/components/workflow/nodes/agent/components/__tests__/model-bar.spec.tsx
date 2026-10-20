import { zProviderWithModelsResponse } from '@dify/contracts/api/console/workspaces/zod.gen'
import { screen } from '@testing-library/react'
import { consoleQuery } from '@/service/console'
import { createModelCreditsFixture } from '@/test/console/model-provider'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import { ModelBar } from '../model-bar'

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

it('distinguishes an unselected agent model from one missing in the installed catalog', () => {
  const { rerender } = render(<ModelBar />, { queryClient: createClient() })
  expect(screen.getByText('workflow.nodes.agent.modelNotSelected')).toBeInTheDocument()

  rerender(<ModelBar provider="openai" model="gpt-4.1" />)
  expect(screen.queryByText('workflow.nodes.agent.modelNotSelected')).not.toBeInTheDocument()
  expect(screen.getByText('workflowAgent.nodes.agent.modelNotInstallTooltip')).toBeInTheDocument()

  rerender(<ModelBar provider="openai" model="gpt-4o" />)
  expect(screen.getByText('GPT-4o')).toBeInTheDocument()
  expect(
    screen.queryByText('workflowAgent.nodes.agent.modelNotInstallTooltip'),
  ).not.toBeInTheDocument()
})
