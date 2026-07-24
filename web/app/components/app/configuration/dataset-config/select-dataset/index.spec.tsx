import type { DataSet } from '@/models/datasets'
import { act, fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'

import { describe, expect, it, vi } from 'vitest'
import { IndexingType } from '@/app/components/datasets/create/step-two'
import { DatasetPermission } from '@/models/datasets'
import { RETRIEVE_METHOD } from '@/types/app'
import SelectDataSet from './index'

vi.mock('@/i18n-config/i18next-config', () => ({
  default: {
    changeLanguage: vi.fn(),
    addResourceBundle: vi.fn(),
    use: vi.fn().mockReturnThis(),
    init: vi.fn(),
    addResource: vi.fn(),
    hasResourceBundle: vi.fn().mockReturnValue(true),
  },
}))
const mockUseInfiniteScroll = vi.fn()
vi.mock('ahooks', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(typeof actual === 'object' && actual !== null ? actual : {}),
    useInfiniteScroll: (...args: any[]) => mockUseInfiniteScroll(...args),
  }
})

const mockUseInfiniteDatasets = vi.fn()
vi.mock('@/service/knowledge/use-dataset', () => ({
  useInfiniteDatasets: (...args: any[]) => mockUseInfiniteDatasets(...args),
}))

vi.mock('@/hooks/use-knowledge', () => ({
  useKnowledge: () => ({
    formatIndexingTechniqueAndMethod: (tech: string, method: string) => `${tech}:${method}`,
  }),
}))

const baseProps = {
  isShow: true,
  onClose: vi.fn(),
  selectedIds: [] as string[],
  onSelect: vi.fn(),
}

const makeDataset = (overrides: Partial<DataSet>): DataSet => ({
  id: 'dataset-id',
  name: 'Dataset Name',
  provider: 'internal',
  icon_info: {
    icon_type: 'emoji',
    icon: '💾',
    icon_background: '#fff',
    icon_url: '',
  },
  embedding_available: true,
  is_multimodal: false,
  description: '',
  permission: DatasetPermission.allTeamMembers,
  indexing_technique: IndexingType.ECONOMICAL,
  retrieval_model_dict: {
    search_method: RETRIEVE_METHOD.fullText,
    top_k: 5,
    reranking_enable: false,
    reranking_model: {
      reranking_model_name: '',
      reranking_provider_name: '',
    },
    score_threshold_enabled: false,
    score_threshold: 0,
  },
  ...overrides,
} as DataSet)

describe('SelectDataSet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders dataset entries, allows selection, and fires onSelect', async () => {
    const datasetOne = makeDataset({
      id: 'set-1',
      name: 'Dataset One',
      is_multimodal: true,
      indexing_technique: IndexingType.ECONOMICAL,
    })
    const datasetTwo = makeDataset({
      id: 'set-2',
      name: 'Hidden Dataset',
      embedding_available: false,
      provider: 'external',
    })
    mockUseInfiniteDatasets.mockReturnValue({
      data: { pages: [{ data: [datasetOne, datasetTwo] }] },
      isLoading: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
    })

    const onSelect = vi.fn()
    await act(async () => {
      render(<SelectDataSet {...baseProps} onSelect={onSelect} selectedIds={[]} />)
    })

    expect(screen.getByText('Dataset One')).toBeInTheDocument()
    expect(screen.getByText('Hidden Dataset')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByText('Dataset One'))
    })
    expect(screen.getByText('1 appDebug.feature.dataSet.selected')).toBeInTheDocument()

    const addButton = screen.getByRole('button', { name: 'common.operation.add' })
    await act(async () => {
      fireEvent.click(addButton)
    })
    expect(onSelect).toHaveBeenCalledWith([datasetOne])
  })

  it('shows empty state when no datasets are available and disables add', async () => {
    mockUseInfiniteDatasets.mockReturnValue({
      data: { pages: [{ data: [] }] },
      isLoading: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
    })

    await act(async () => {
      render(<SelectDataSet {...baseProps} onSelect={vi.fn()} selectedIds={[]} />)
    })

    expect(screen.getByText('appDebug.feature.dataSet.noDataSet')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'appDebug.feature.dataSet.toCreate' })).toHaveAttribute('href', '/datasets/create')
    expect(screen.getByRole('button', { name: 'common.operation.add' })).toBeDisabled()
  })
})
