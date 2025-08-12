import type { ActionItem, KnowledgeSearchResult } from './types'
import type { DataSet } from '@/models/datasets'
import { fetchDatasets } from '@/service/datasets'
import { Folder } from '../../base/icons/src/vender/solid/files'
import cn from '@/utils/classnames'

const EXTERNAL_PROVIDER = 'external' as const
const isExternalProvider = (provider: string): boolean => provider === EXTERNAL_PROVIDER

const parser = (datasets: DataSet[]): KnowledgeSearchResult[] => {
  return datasets.map((dataset) => {
    const path = isExternalProvider(dataset.provider) ? `/datasets/${dataset.id}/hitTesting` : `/datasets/${dataset.id}/documents`
    return {
      id: dataset.id,
      title: dataset.name,
      description: dataset.description,
      type: 'knowledge' as const,
      path,
      icon: (
        <div className={cn(
          'flex shrink-0 items-center justify-center rounded-md border-[0.5px] border-[#E0EAFF] bg-[#F5F8FF] p-2.5',
          !dataset.embedding_available && 'opacity-50 hover:opacity-100',
        )}>
          <Folder className='h-5 w-5 text-[#444CE7]' />
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
  // action,
  search: async (_, searchTerm = '', _locale) => {
    try {
      const response = await fetchDatasets({
        url: '/datasets',
        params: {
          page: 1,
          limit: 10,
          keyword: searchTerm,
        },
      })
      const datasets = response?.data || []
      return parser(datasets)
    }
    catch (error) {
      console.warn('Knowledge search failed:', error)
      return []
    }
  },
}
