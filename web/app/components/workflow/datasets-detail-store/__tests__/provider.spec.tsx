import type { DatasetDetailWithPartialMembersResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { Node } from '../../types'
import { render, screen, waitFor } from '@testing-library/react'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { createStartNode } from '../../__tests__/fixtures'
import { BlockEnum } from '../../types'
import DatasetsDetailProvider from '../provider'
import { useDatasetsDetailStore } from '../store'

const mockFetchDatasets = vi.fn()

vi.mock('@/service/datasets', () => ({
  fetchDatasets: (params: unknown) => mockFetchDatasets(params),
}))

const Consumer = () => {
  const datasets = useDatasetsDetailStore((state) => state.datasetsDetail)
  return (
    <ul>
      {Object.entries(datasets).map(([id, dataset]) => (
        <li key={id}>
          {id}: {dataset.name}
        </li>
      ))}
    </ul>
  )
}

const createWorkflowNode = (datasetIds: string[] = []): Node<{ dataset_ids: string[] }> => ({
  id: `node-${datasetIds.join('-') || 'empty'}`,
  type: 'custom',
  position: { x: 0, y: 0 },
  data: {
    title: 'Knowledge',
    desc: '',
    type: BlockEnum.KnowledgeRetrieval,
    dataset_ids: datasetIds,
  },
})

const createDataset = (id: string): DatasetDetailWithPartialMembersResponse =>
  createDatasetFixture({ id, name: `Dataset ${id}` })

describe('datasets-detail-store provider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchDatasets.mockResolvedValue({ data: [] })
  })

  it('should provide the datasets detail store without fetching when no knowledge datasets are selected', () => {
    render(
      <DatasetsDetailProvider nodes={[createStartNode({ id: 'node-start' })]}>
        <Consumer />
      </DatasetsDetailProvider>,
    )

    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
    expect(mockFetchDatasets).not.toHaveBeenCalled()
  })

  it('should fetch unique dataset details from knowledge retrieval nodes and store them', async () => {
    mockFetchDatasets.mockResolvedValue({
      data: [createDataset('dataset-1'), createDataset('dataset-2')],
    })

    render(
      <DatasetsDetailProvider
        nodes={[createWorkflowNode(['dataset-1', 'dataset-2']), createWorkflowNode(['dataset-2'])]}
      >
        <Consumer />
      </DatasetsDetailProvider>,
    )

    await waitFor(() => {
      expect(mockFetchDatasets).toHaveBeenCalledWith({
        params: {
          page: 1,
          ids: ['dataset-1', 'dataset-2'],
        },
      })
      expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
        'dataset-1: Dataset dataset-1',
        'dataset-2: Dataset dataset-2',
      ])
    })
  })
})
