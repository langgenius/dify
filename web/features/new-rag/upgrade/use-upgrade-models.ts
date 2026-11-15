import type {
  KnowledgeFsUpgradeModelIssueResponse,
  KnowledgeFsUpgradeModelRecommendationResponse,
  KnowledgeFsUpgradeModelRecommendationsResponse,
  KnowledgeFsUpgradeModelsPayload,
} from '@dify/contracts/api/console/datasets/types.gen'
import type { ModelSelectorValue } from '@/app/components/header/account-setting/model-provider-page/model-selector/types'
import type {
  CreationModelFieldState,
  CreationModelIssue,
  CreationModelType,
} from '@/features/new-rag/create/use-creation-models'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { modelIssueFromCatalog } from '@/features/new-rag/create/use-creation-models'
import { consoleQuery } from '@/service/console'

type UpgradeModelKey = keyof KnowledgeFsUpgradeModelsPayload

export const UPGRADE_MODEL_KEYS = ['embedding', 'rerank', 'reasoning'] as const

const MODEL_TYPES = {
  embedding: 'text-embedding',
  rerank: 'rerank',
  reasoning: 'llm',
} as const satisfies Record<UpgradeModelKey, CreationModelType>

type Selections = Partial<Record<UpgradeModelKey, ModelSelectorValue>>

type Rejection = {
  fingerprint: string
  issues: KnowledgeFsUpgradeModelIssueResponse[]
}

type UpgradeModelsState = {
  datasetId?: string
  rejection?: Rejection
  selections: Selections
}

export function upgradeModelsFingerprint(models: KnowledgeFsUpgradeModelsPayload) {
  return UPGRADE_MODEL_KEYS.map(
    (key) => `${key}:${models[key].provider}/${models[key].model}`,
  ).join('|')
}

function issueFromReason(
  reason: KnowledgeFsUpgradeModelIssueResponse['reason'],
): CreationModelIssue {
  if (reason === 'not_found' || reason === 'deprecated') return 'unavailable'
  return reason
}

function useUpgradeModel({
  enabled,
  modelType,
  rejectedIssue,
  setSelection,
  value,
}: {
  enabled: boolean
  modelType: CreationModelType
  rejectedIssue: KnowledgeFsUpgradeModelIssueResponse | undefined
  setSelection: (value: ModelSelectorValue | undefined) => void
  value: ModelSelectorValue | undefined
}): CreationModelFieldState {
  const catalog = useQuery(
    consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryOptions({
      input: enabled ? { params: { model_type: modelType } } : skipToken,
      select: ({ data }) => data,
    }),
  )
  const models = catalog.data ?? []
  const pending = enabled && catalog.isPending
  const issue: CreationModelIssue | undefined = !enabled
    ? undefined
    : catalog.isError
      ? 'load-error'
      : rejectedIssue
        ? issueFromReason(rejectedIssue.reason)
        : pending
          ? undefined
          : modelIssueFromCatalog(models, value)

  return {
    issue,
    models,
    pending,
    refreshing: catalog.isFetching,
    retry: () => catalog.refetch(),
    setSelection,
    value,
  }
}

export function useUpgradeModels({
  datasetId,
  recommendations,
}: {
  datasetId: string | undefined
  recommendations: KnowledgeFsUpgradeModelRecommendationsResponse | null | undefined
}) {
  // Choices are scoped to one dataset so reopening the dialog for another one starts fresh.
  const [state, setState] = useState<UpgradeModelsState>({ selections: {} })
  const forDataset = (current: UpgradeModelsState): UpgradeModelsState =>
    current.datasetId === datasetId ? current : { datasetId, selections: {} }
  const scoped = forDataset(state)
  const enabled = Boolean(datasetId && recommendations !== undefined)
  const setSelection = (key: UpgradeModelKey) => (value: ModelSelectorValue | undefined) =>
    setState((current) => {
      const own = forDataset(current)
      return { ...own, selections: { ...own.selections, [key]: value } }
    })
  // Recommendations the backend marks unavailable start empty so the user must choose.
  const values: Record<UpgradeModelKey, ModelSelectorValue | undefined> = {
    embedding: scoped.selections.embedding ?? recommendedValue(recommendations?.embedding),
    rerank: scoped.selections.rerank ?? recommendedValue(recommendations?.rerank),
    reasoning: scoped.selections.reasoning ?? recommendedValue(recommendations?.reasoning),
  }
  const draftPayload = toPayload(values)
  // A rejection only applies while the rejected combination is still selected.
  const activeRejection =
    scoped.rejection &&
    draftPayload &&
    scoped.rejection.fingerprint === upgradeModelsFingerprint(draftPayload)
      ? scoped.rejection
      : undefined
  const field = (key: UpgradeModelKey) => ({
    enabled,
    modelType: MODEL_TYPES[key],
    rejectedIssue: activeRejection?.issues.find((issue) => issue.field === key),
    setSelection: setSelection(key),
    value: values[key],
  })

  const embedding = useUpgradeModel(field('embedding'))
  const rerank = useUpgradeModel(field('rerank'))
  const reasoning = useUpgradeModel(field('reasoning'))
  const fields = { embedding, rerank, reasoning }
  const pending = Object.values(fields).some((entry) => entry.pending)
  const invalid = Object.values(fields).some((entry) => entry.issue)

  return {
    fields,
    payload: !pending && !invalid ? draftPayload : undefined,
    refresh: () => Promise.allSettled(Object.values(fields).map((entry) => entry.retry())),
    reject: (
      models: KnowledgeFsUpgradeModelsPayload,
      issues: KnowledgeFsUpgradeModelIssueResponse[],
    ) =>
      setState((current) => ({
        ...forDataset(current),
        rejection: { fingerprint: upgradeModelsFingerprint(models), issues },
      })),
    reset: () => setState({ selections: {} }),
  }
}

// Legacy datasets may store short provider names; expand them like the backend's ModelProviderID.
function fullProviderId(provider: string) {
  const parts = provider.split('/')
  if (parts.length === 1) return `langgenius/${provider}/${provider}`
  if (parts.length === 2) return `${provider}/${parts[1]}`
  return provider
}

function recommendedValue(
  recommendation: KnowledgeFsUpgradeModelRecommendationResponse | undefined,
): ModelSelectorValue | undefined {
  if (!recommendation?.available || !recommendation.value) return undefined
  const { model, provider } = recommendation.value
  return { model, provider: fullProviderId(provider) }
}

function toPayload(
  values: Record<UpgradeModelKey, ModelSelectorValue | undefined>,
): KnowledgeFsUpgradeModelsPayload | undefined {
  const { embedding, rerank, reasoning } = values
  if (!embedding || !rerank || !reasoning) return undefined
  const choice = ({ provider, model }: ModelSelectorValue) => ({ provider, model })
  return { embedding: choice(embedding), rerank: choice(rerank), reasoning: choice(reasoning) }
}
