import type { DatasetListItemResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { ActionItem, KnowledgeSearchResult } from './types'
import { cn } from '@langgenius/dify-ui/cn'
import { consoleQuery } from '@/service/client'
import { Folder } from '../../base/icons/src/vender/solid/files'

const EXTERNAL_PROVIDER = 'external' as const
const isExternalProvider = (provider: string): boolean => provider === EXTERNAL_PROVIDER

function getKnowledgeResults(datasets: DatasetListItemResponse[]): KnowledgeSearchResult[] {
  return datasets.map((dataset) => {
    const path = isExternalProvider(dataset.provider)
      ? `/datasets/${dataset.id}/hitTesting`
      : `/datasets/${dataset.id}/documents`
    return {
      id: dataset.id,
      title: dataset.name,
      description: dataset.description ?? undefined,
      type: 'knowledge' as const,
      path,
      icon: (
        <div
          className={cn(
            'flex shrink-0 items-center justify-center rounded-md border-[0.5px] border-[#E0EAFF] bg-[#F5F8FF] p-2.5',
            !dataset.embedding_available && 'opacity-50 hover:opacity-100',
          )}
        >
          <Folder className="h-5 w-5 text-[#444CE7]" />
        </div>
      ),
      data: dataset,
    }
  })
}

export const knowledgeAction: ActionItem = {
  key: '@knowledge',
  shortcut: '@kb',
  title: 'Search Knowledge Bases',
  description: 'Search and navigate to your knowledge bases',
  source: 'remote',
}

export function knowledgeSearchQueryOptions(searchTerm: string) {
  return consoleQuery.datasets.get.queryOptions({
    input: {
      query: {
        page: 1,
        limit: 10,
        keyword: searchTerm,
      },
    },
    retry: false,
    select: (response) => getKnowledgeResults(response.data),
  })
}
