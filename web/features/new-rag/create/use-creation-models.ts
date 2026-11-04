import type {
  ModelStatus,
  ProviderWithModelsResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { ModelSelectorValue } from '@/app/components/header/account-setting/model-provider-page/model-selector/types'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { consoleQuery } from '@/service/console'

export type CreationModelSelections = {
  reasoning: ModelSelectorValue
  embedding: ModelSelectorValue
  rerank: ModelSelectorValue
}

export type CreationModelIssue =
  | Exclude<ModelStatus, 'active'>
  | 'missing'
  | 'load-error'
  | 'unavailable'

export type CreationModelType = 'llm' | 'text-embedding' | 'rerank'

export type CreationModelFieldState = {
  issue: CreationModelIssue | undefined
  models: ProviderWithModelsResponse[]
  pending: boolean
  refreshing: boolean
  retry: () => Promise<unknown>
  setSelection: (value: ModelSelectorValue | undefined) => void
  value: ModelSelectorValue | undefined
}

export function modelIssueFromCatalog(
  models: ProviderWithModelsResponse[],
  value: ModelSelectorValue | undefined,
): CreationModelIssue | undefined {
  if (!value) return 'missing'
  const currentModel = models
    .find((provider) => provider.provider === value.provider)
    ?.models.find((model) => model.model === value.model)
  if (!currentModel) return 'unavailable'
  return currentModel.status === 'active' ? undefined : currentModel.status
}

function useCreationModel(modelType: CreationModelType): CreationModelFieldState {
  const [selection, setSelection] = useState<ModelSelectorValue>()
  const defaultModel = useQuery(
    consoleQuery.workspaces.current.defaultModel.get.queryOptions({
      input: { query: { model_type: modelType } },
      select: ({ data }) =>
        data ? { model: data.model, provider: data.provider.provider } : undefined,
    }),
  )
  const catalog = useQuery(
    consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryOptions({
      input: { params: { model_type: modelType } },
      select: ({ data }) => data,
    }),
  )
  const value = selection ?? defaultModel.data
  const models = catalog.data ?? []
  const pending = catalog.isPending || (!selection && defaultModel.isPending)
  const issue: CreationModelIssue | undefined =
    catalog.isError || (!selection && defaultModel.isError)
      ? 'load-error'
      : pending
        ? undefined
        : modelIssueFromCatalog(models, value)

  return {
    issue,
    models,
    pending,
    refreshing: catalog.isFetching || (!selection && defaultModel.isFetching),
    retry: () => Promise.allSettled([catalog.refetch(), defaultModel.refetch()]),
    setSelection,
    value,
  }
}

export function useCreationModels() {
  const reasoning = useCreationModel('llm')
  const embedding = useCreationModel('text-embedding')
  const rerank = useCreationModel('rerank')
  const fields = { reasoning, embedding, rerank }
  const pending = Object.values(fields).some((field) => field.pending)
  const invalid = Object.values(fields).some((field) => field.issue)
  const selections: CreationModelSelections | undefined =
    !pending && !invalid && reasoning.value && embedding.value && rerank.value
      ? { reasoning: reasoning.value, embedding: embedding.value, rerank: rerank.value }
      : undefined

  return {
    fields,
    invalid,
    pending,
    selections,
    rememberSelections: (values: CreationModelSelections) => {
      reasoning.setSelection(values.reasoning)
      embedding.setSelection(values.embedding)
      rerank.setSelection(values.rerank)
    },
  }
}
