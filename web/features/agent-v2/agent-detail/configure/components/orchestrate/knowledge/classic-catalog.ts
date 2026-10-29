import type { DatasetDetailWithPartialMembersResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { AgentKnowledgeRetrievalItem } from '@/features/agent-v2/agent-composer/form-state'
import { useInfiniteQuery } from '@tanstack/react-query'
import { getMultipleRetrievalConfig } from '@/app/components/workflow/nodes/knowledge-retrieval/utils'
import { DATASET_DEFAULT } from '@/config'
import { consoleQuery } from '@/service/console'

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
  const boundIds = new Set(
    bindings.flatMap((item) =>
      (item.selectedDatasets ?? item.datasetRefs ?? []).flatMap((dataset) =>
        dataset.id ? [dataset.id] : [],
      ),
    ),
  )
  const datasets =
    query.data?.pages
      .flatMap((page) => page.data)
      .filter(
        (dataset) =>
          !boundIds.has(dataset.id) &&
          (dataset.indexing_technique || dataset.provider === 'external'),
      ) ?? []
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

  return { query, bindings, datasets, createBinding }
}
