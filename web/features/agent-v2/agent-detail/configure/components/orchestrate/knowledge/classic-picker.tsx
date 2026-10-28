import type { DatasetDetailWithPartialMembersResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { AgentKnowledgeRetrievalItem } from '@/features/agent-v2/agent-composer/form-state'
import { Button } from '@langgenius/dify-ui/button'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { getMultipleRetrievalConfig } from '@/app/components/workflow/nodes/knowledge-retrieval/utils'
import { DATASET_DEFAULT } from '@/config'
import { consoleQuery } from '@/service/console'
import { KnowledgeBindingOption } from './binding-option'

type Props = {
  draft: AgentKnowledgeRetrievalItem[]
  initialBindings: AgentKnowledgeRetrievalItem[]
  filter: string
  showSourceLabel: boolean
  onSelect: (item: AgentKnowledgeRetrievalItem) => void
  onRemove: (id: string) => void
}

export function ClassicKnowledgePicker({
  draft,
  initialBindings,
  filter,
  showSourceLabel,
  onSelect,
  onRemove,
}: Props) {
  const { t } = useTranslation(['agentV2', 'common', 'knowledgeSpace', 'appDebug'])
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
  const matches = (name?: string | null) =>
    (name ?? '').toLocaleLowerCase().includes(filter.toLocaleLowerCase())
  const visibleBindings = bindings.filter(
    (item) =>
      matches(item.name) ||
      (item.selectedDatasets ?? item.datasetRefs)?.some((dataset) => matches(dataset.name)),
  )
  const datasets =
    query.data?.pages
      .flatMap((page) => page.data)
      .filter(
        (dataset) =>
          !boundIds.has(dataset.id) &&
          (dataset.indexing_technique || dataset.provider === 'external') &&
          matches(dataset.name),
      ) ?? []
  const select = (dataset: DatasetDetailWithPartialMembersResponse) => {
    let name = dataset.name
    let suffix = 2
    while (draft.some((item) => item.name?.toLocaleLowerCase() === name.toLocaleLowerCase()))
      name = `${dataset.name} (${suffix++})`
    onSelect({
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
    })
  }
  return (
    <fieldset className="min-w-0 space-y-1">
      <legend className={showSourceLabel ? 'px-2 system-xs-medium text-text-secondary' : 'sr-only'}>
        {showSourceLabel
          ? t(($) => $['view.classic'], { ns: 'knowledgeSpace' })
          : t(($) => $['agentDetail.configure.knowledgeRetrieval.dialog.knowledge.label'])}
      </legend>
      {visibleBindings.map((item) => (
        <KnowledgeBindingOption
          key={item.id}
          name={item.name || item.id}
          description={item.description}
          checked={draft.some((row) => row.id === item.id)}
          disabled={false}
          onCheckedChange={(checked) => (checked ? onSelect(item) : onRemove(item.id))}
        />
      ))}
      {datasets.map((dataset) => (
        <KnowledgeBindingOption
          key={dataset.id}
          name={dataset.name}
          description={dataset.description}
          checked={false}
          disabled={!dataset.embedding_available}
          onCheckedChange={() => select(dataset)}
        />
      ))}
      {query.isPending && (
        <div role="status" className="h-14 animate-pulse rounded-lg bg-background-section">
          <span className="sr-only">{t(($) => $.loading, { ns: 'common' })}</span>
        </div>
      )}
      {query.isError && (
        <div role="alert" className="space-y-2 p-3 text-text-destructive">
          <p>{t(($) => $.error, { ns: 'common' })}</p>
          <Button
            onClick={() => {
              void query.refetch()
            }}
            loading={query.isFetching}
          >
            {t(($) => $['operation.retry'], { ns: 'common' })}
          </Button>
        </div>
      )}
      {query.isSuccess && !visibleBindings.length && !datasets.length && (
        <p className="px-2 py-8 text-center text-text-tertiary">
          {t(($) => $['feature.dataSet.noDataSet'], { ns: 'appDebug' })}
        </p>
      )}
      {query.hasNextPage && (
        <Button
          onClick={() => {
            void query.fetchNextPage()
          }}
          loading={query.isFetchingNextPage}
        >
          {t(($) => $.loadMore, { ns: 'knowledgeSpace' })}
        </Button>
      )}
    </fieldset>
  )
}
