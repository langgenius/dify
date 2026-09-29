import type { Node } from '../../types'
import type { DataSet } from '@/models/datasets'
import { act, render, screen, waitFor } from '@testing-library/react'
import { WorkflowContextProvider } from '../../context'
import { useWorkflowStore } from '../../store/workflow'
import { BlockEnum } from '../../types'
import DatasetsDetailProvider from '../provider'
import { useDatasetsDetailStore } from '../store'

const mockFetchDatasets = vi.fn()
const workflowStore = { current: null as ReturnType<typeof useWorkflowStore> | null }

vi.mock('@/service/datasets', () => ({
  fetchDatasets: (params: unknown) => mockFetchDatasets(params),
}))

const Consumer = () => {
  const datasetCount = useDatasetsDetailStore((state) => Object.keys(state.datasetsDetail).length)
  return <div>{`dataset-count:${datasetCount}`}</div>
}

function WorkflowStoreProbe() {
  workflowStore.current = useWorkflowStore()
  return null
}

const createWorkflowNode = (datasetIds: string[] = []): Node =>
  ({
    id: `node-${datasetIds.join('-') || 'empty'}`,
    type: 'custom',
    position: { x: 0, y: 0 },
    data: {
      title: 'Knowledge',
      desc: '',
      type: BlockEnum.KnowledgeRetrieval,
      dataset_ids: datasetIds,
    },
  }) as unknown as Node

const createDataset = (id: string): DataSet =>
  ({
    id,
    name: `Dataset ${id}`,
  }) as DataSet

describe('datasets-detail-store provider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    workflowStore.current = null
    mockFetchDatasets.mockResolvedValue({ data: [] })
  })

  it('should provide the datasets detail store without fetching when no knowledge datasets are selected', () => {
    render(
      <WorkflowContextProvider>
        <DatasetsDetailProvider
          nodes={[
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
        </DatasetsDetailProvider>
      </WorkflowContextProvider>,
    )

    expect(screen.getByText('dataset-count:0')).toBeInTheDocument()
    expect(mockFetchDatasets).not.toHaveBeenCalled()
  })

  it('should fetch unique dataset details from knowledge retrieval nodes and store them', async () => {
    mockFetchDatasets.mockResolvedValue({
      data: [createDataset('dataset-1'), createDataset('dataset-2')],
    })

    render(
      <WorkflowContextProvider>
        <DatasetsDetailProvider
          nodes={[
            createWorkflowNode(['dataset-1', 'dataset-2']),
            createWorkflowNode(['dataset-2']),
          ]}
        >
          <Consumer />
        </DatasetsDetailProvider>
      </WorkflowContextProvider>,
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

  it('loads metadata for a knowledge retrieval node added to the live canvas', async () => {
    mockFetchDatasets.mockResolvedValue({ data: [createDataset('imported-dataset')] })

    render(
      <WorkflowContextProvider>
        <WorkflowStoreProbe />
        <DatasetsDetailProvider nodes={[]}>
          <Consumer />
        </DatasetsDetailProvider>
      </WorkflowContextProvider>,
    )
    expect(mockFetchDatasets).not.toHaveBeenCalled()
    expect(screen.getByText('dataset-count:0')).toBeInTheDocument()

    act(() => {
      workflowStore.current?.getState().setNodes([createWorkflowNode(['imported-dataset'])])
    })
    await waitFor(() =>
      expect(mockFetchDatasets).toHaveBeenCalledWith({
        url: '/datasets',
        params: { page: 1, ids: ['imported-dataset'] },
      }),
    )
    expect(await screen.findByText('dataset-count:1')).toBeInTheDocument()
    expect(mockFetchDatasets).toHaveBeenCalledTimes(1)

    act(() => {
      workflowStore.current
        ?.getState()
        .setNodes([{ ...createWorkflowNode(['imported-dataset']), position: { x: 40, y: 0 } }])
    })
    expect(mockFetchDatasets).toHaveBeenCalledTimes(1)
  })

  it('retries a failed metadata request on the next graph data change', async () => {
    mockFetchDatasets
      .mockRejectedValueOnce(new Error('Network unavailable'))
      .mockResolvedValueOnce({ data: [createDataset('dataset-1')] })
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      render(
        <WorkflowContextProvider>
          <WorkflowStoreProbe />
          <DatasetsDetailProvider nodes={[]}>
            <Consumer />
          </DatasetsDetailProvider>
        </WorkflowContextProvider>,
      )
      act(() => {
        workflowStore.current?.getState().setNodes([createWorkflowNode(['dataset-1'])])
      })
      await waitFor(() =>
        expect(report).toHaveBeenCalledWith(
          'Failed to load workflow dataset details',
          expect.any(Error),
        ),
      )
      expect(mockFetchDatasets).toHaveBeenCalledTimes(1)
      expect(screen.getByText('dataset-count:0')).toBeInTheDocument()

      act(() => {
        workflowStore.current?.getState().setNodes([
          {
            ...createWorkflowNode(['dataset-1']),
            data: { ...createWorkflowNode(['dataset-1']).data, title: 'Updated knowledge' },
          },
        ])
      })
      await waitFor(() => expect(mockFetchDatasets).toHaveBeenCalledTimes(2))
      expect(await screen.findByText('dataset-count:1')).toBeInTheDocument()
    } finally {
      report.mockRestore()
    }
  })
})
