import type { DatasetDetailWithPartialMembersResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { AgentKnowledgeRetrievalItem } from '@/features/agent-v2/agent-composer/form-state'
import { useInfiniteQuery } from '@tanstack/react-query'
import { getMultipleRetrievalConfig } from '@/app/components/workflow/nodes/knowledge-retrieval/utils'
import { DATASET_DEFAULT } from '@/config'
import { consoleQuery } from '@/service/console'

export type ClassicCatalogEntry =
  | { kind: 'binding'; item: AgentKnowledgeRetrievalItem }
  | { kind: 'dataset'; dataset: DatasetDetailWithPartialMembersResponse }

export function useClassicKnowledgeCatalog({
  draft,
  initialBindings,
}: {
  draft: AgentKnowledgeRetrievalItem[]
  initialBindings: AgentKnowledgeRetrievalItem[]
}) {
  const query = useInfiniteQuery(
    consoleQuery.datasets.get.infiniteOptions({
      input: (page: number) => ({ query: { page, limit: 50 } }),
      initialPageParam: 1,
      getNextPageParam: (lastPage) => (lastPage.has_more ? lastPage.page + 1 : undefined),
    }),
  )
  // A saved set is one option, even when it contains multiple datasets. Deselecting
  // and reselecting it restores its identity, query policy and retrieval settings.
  const bindings = [
    ...new Map(
      [...initialBindings, ...draft]
        .filter((item) => !item.controlSpaceId)
        .map((item) => [item.id, item]),
    ).values(),
  ]
  const datasetIdsOf = (item: AgentKnowledgeRetrievalItem) =>
    (item.selectedDatasets ?? item.datasetRefs ?? []).flatMap((dataset) =>
      dataset.id ? [dataset.id] : [],
    )
  const boundIds = new Set(bindings.flatMap(datasetIdsOf))
  const catalog =
    query.data?.pages
      .flatMap((page) => page.data)
      .filter((dataset) => dataset.indexing_technique || dataset.provider === 'external') ?? []
  const datasets = catalog.filter((dataset) => !boundIds.has(dataset.id))
  // Saved sets lead the list. A set created in this dialog takes the place of the dataset
  // it came from, so ticking or unticking a row never moves it under the pointer.
  const savedIds = new Set(initialBindings.map((item) => item.id))
  const createdByDataset = new Map<string, AgentKnowledgeRetrievalItem>()
  for (const item of bindings) {
    const origin = datasetIdsOf(item)[0]
    if (!savedIds.has(item.id) && origin) createdByDataset.set(origin, item)
  }
  const placed = new Set<string>()
  const entries: ClassicCatalogEntry[] = [
    ...bindings
      .filter((item) => savedIds.has(item.id))
      .map((item) => ({ kind: 'binding' as const, item })),
    ...catalog.flatMap((dataset): ClassicCatalogEntry[] => {
      const created = createdByDataset.get(dataset.id)
      if (created && !placed.has(created.id)) {
        placed.add(created.id)
        return [{ kind: 'binding', item: created }]
      }
      return boundIds.has(dataset.id) ? [] : [{ kind: 'dataset', dataset }]
    }),
  ]
  for (const item of bindings) {
    if (!savedIds.has(item.id) && !placed.has(item.id)) entries.push({ kind: 'binding', item })
  }
  const createBinding = (
    dataset: DatasetDetailWithPartialMembersResponse,
    current: AgentKnowledgeRetrievalItem[],
  ): AgentKnowledgeRetrievalItem => {
    let name = dataset.name
    let suffix = 2
    while (current.some((item) => item.name?.toLocaleLowerCase() === name.toLocaleLowerCase()))
      name = `${dataset.name} (${suffix++})`
    return {
      id: crypto.randomUUID(),
      name,
      description: dataset.description ?? '',
      selectedDatasets: [dataset],
      queryMode: 'agent',
      multipleRetrievalConfig: getMultipleRetrievalConfig(
        { top_k: DATASET_DEFAULT.top_k, score_threshold: null, reranking_enable: false },
        [dataset],
        [],
      ),
    }
  }

  return { query, bindings, datasets, entries, createBinding }
}
