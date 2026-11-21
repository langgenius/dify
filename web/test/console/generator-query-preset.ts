import type { QueryClient } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'
import {
  createCatalogModelFixture,
  createDefaultModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from './model-provider'
import { seedToolProviders } from './tool-providers'

export const seedGeneratorQueries = (
  queryClient: QueryClient,
  { template, type }: { template: string; type: 'code' | 'prompt' },
) => {
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  seedModelProviderQueries(queryClient, [
    createModelCatalogFixture({
      models: [
        createCatalogModelFixture({
          model: 'gpt-4o-mini',
          label: { en_US: 'GPT-4o mini' },
          model_properties: { mode: 'chat' },
        }),
      ],
    }),
  ])
  queryClient.setQueryData(
    consoleQuery.workspaces.current.defaultModel.get.queryKey({
      input: { query: { model_type: 'llm' } },
    }),
    { data: createDefaultModelFixture({ model: 'gpt-4o-mini' }) },
  )
  queryClient.setQueryDefaults(
    consoleQuery.workspaces.current.modelProviders.byProvider.models.parameterRules.get.key(),
    { initialData: { data: [] } },
  )
  queryClient.setQueryData(
    consoleQuery.instructionGenerate.template.post.queryOptions({ input: { body: { type } } })
      .queryKey,
    { data: template },
  )
}
