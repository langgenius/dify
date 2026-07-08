import type { Node } from '../../types'
import type { DataSet } from '@/models/datasets'
import { act, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { BlockEnum } from '../../types'
import DatasetsDetailProvider from '../provider'
import { useDatasetsDetailStore } from '../store'

const mockFetchDatasets = vi.fn()

vi.mock('@/service/datasets', () => ({
  fetchDatasets: (params: unknown) => mockFetchDatasets(params),
}))

const Consumer = () => {
  const datasetCount = useDatasetsDetailStore(state => Object.keys(state.datasetsDetail).length)
  return <div>{`dataset-count:${datasetCount}`}</div>
}

const SeededConsumer = ({
  datasets,
}: {
  datasets: DataSet[]
}) => {
  const updateDatasetsDetail = useDatasetsDetailStore(state => state.updateDatasetsDetail)

  useEffect(() => {
    updateDatasetsDetail(datasets)
  }, [datasets, updateDatasetsDetail])

  return <Consumer />
}

const createWorkflowNode = (datasetIds: string[] = []): Node => ({
  id: `node-${datasetIds.join('-') || 'empty'}`,
  type: 'custom',
  position: { x: 0, y: 0 },
  data: {
    title: 'Knowledge',
    desc: '',
    type: BlockEnum.KnowledgeRetrieval,
    dataset_ids: datasetIds,
  },
} as unknown as Node)

const createDataset = (id: string): DataSet => ({
  id,
  name: `Dataset ${id}`,
} as DataSet)

describe('datasets-detail-store provider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchDatasets.mockResolvedValue({ data: [] })
  })

  it('should provide the datasets detail store without fetching when no knowledge datasets are selected', () => {
    render(
      <DatasetsDetailProvider nodes={[
        {
          id: 'node-start',
          type: 'custom',
          position: { x: 0, y: 0 },
          data: {
            title: 'Start',
            desc: '',
            type: BlockEnum.Start,
          },
        } as unknown as Node,
      ]}
      >
        <Consumer />
      </DatasetsDetailProvider>,
    )

    expect(screen.getByText('dataset-count:0')).toBeInTheDocument()
    expect(mockFetchDatasets).not.toHaveBeenCalled()
  })

  it('should fetch unique dataset details from knowledge retrieval nodes and store them', async () => {
    mockFetchDatasets.mockResolvedValue({
      data: [createDataset('dataset-1'), createDataset('dataset-2')],
    })

    render(
      <DatasetsDetailProvider nodes={[
        createWorkflowNode(['dataset-1', 'dataset-2']),
        createWorkflowNode(['dataset-2']),
      ]}
      >
        <Consumer />
      </DatasetsDetailProvider>,
    )

    await waitFor(() => {
      expect(mockFetchDatasets).toHaveBeenCalledWith({
        url: '/datasets',
        params: {
          page: 1,
          ids: ['dataset-1', 'dataset-2'],
        },
      })
      expect(screen.getByText('dataset-count:2')).toBeInTheDocument()
    })
  })

  it('should prune stale requested dataset details when the API returns an empty list', async () => {
    let resolveFetch: ((value: { data: DataSet[] }) => void) | undefined
    mockFetchDatasets.mockImplementation(() => new Promise<{ data: DataSet[] }>((resolve) => {
      resolveFetch = resolve
    }))
    const seededDatasets = [createDataset('dataset-1')]

    render(
      <DatasetsDetailProvider nodes={[
        createWorkflowNode(['dataset-1']),
      ]}
      >
        <SeededConsumer datasets={seededDatasets} />
      </DatasetsDetailProvider>,
    )

    await waitFor(() => {
      expect(mockFetchDatasets).toHaveBeenCalledWith({
        url: '/datasets',
        params: {
          page: 1,
          ids: ['dataset-1'],
        },
      })
      expect(screen.getByText('dataset-count:1')).toBeInTheDocument()
    })
    expect(resolveFetch).toBeDefined()

    await act(async () => {
      resolveFetch!({ data: [] })
    })

    await waitFor(() => {
      expect(screen.getByText('dataset-count:0')).toBeInTheDocument()
    })
  })
})
