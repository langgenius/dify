import type { DatasetDetailWithPartialMembersResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { KnowledgeRetrievalNodeType } from '../types'
import { render, screen } from '@testing-library/react'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { RETRIEVE_TYPE } from '@/types/app'
import { DatasetsDetailContext } from '../../../datasets-detail-store/provider'
import { createDatasetsDetailStore } from '../../../datasets-detail-store/store'
import { BlockEnum } from '../../../types'
import Node from '../node'
import { MetadataFilteringModeEnum } from '../types'

const createDataset = (
  overrides: Partial<DatasetDetailWithPartialMembersResponse> = {},
): DatasetDetailWithPartialMembersResponse => ({
  ...createDatasetFixture(),
  id: 'dataset-1',
  name: 'Dataset Name',
  ...overrides,
})

const createData = (
  overrides: Partial<KnowledgeRetrievalNodeType> = {},
): KnowledgeRetrievalNodeType => ({
  title: 'Knowledge Retrieval',
  desc: '',
  type: BlockEnum.KnowledgeRetrieval,
  query_variable_selector: ['start', 'sys.query'],
  query_attachment_selector: [],
  dataset_ids: ['dataset-1'],
  retrieval_mode: RETRIEVE_TYPE.multiWay,
  metadata_filtering_mode: MetadataFilteringModeEnum.disabled,
  ...overrides,
})

const renderWithDatasets = (
  data: KnowledgeRetrievalNodeType,
  datasets: DatasetDetailWithPartialMembersResponse[] = [],
) => {
  const store = createDatasetsDetailStore()
  store.getState().updateDatasetsDetail(datasets)

  return render(
    <DatasetsDetailContext.Provider value={store}>
      <Node id="knowledge-node" data={data} />
    </DatasetsDetailContext.Provider>,
  )
}

describe('knowledge-retrieval/node', () => {
  it('renders only the datasets selected by the node', async () => {
    renderWithDatasets(
      createData({
        dataset_ids: ['dataset-1', 'dataset-2'],
      }),
      [
        createDataset(),
        createDataset({
          id: 'dataset-2',
          name: 'Second Dataset',
        }),
        createDataset({ id: 'unselected', name: 'Unselected Dataset' }),
      ],
    )

    expect(await screen.findByText('Dataset Name')).toBeInTheDocument()
    expect(screen.getByText('Second Dataset')).toBeInTheDocument()
    expect(screen.queryByText('Unselected Dataset')).not.toBeInTheDocument()
  })

  it('renders nothing when the node has no dataset ids or no matching dataset details', () => {
    const { container, rerender } = renderWithDatasets(
      createData({
        dataset_ids: ['missing-dataset'],
      }),
      [createDataset()],
    )

    expect(container).toBeEmptyDOMElement()

    const store = createDatasetsDetailStore()
    store.getState().updateDatasetsDetail([createDataset()])

    rerender(
      <DatasetsDetailContext.Provider value={store}>
        <Node
          id="knowledge-node"
          data={createData({
            dataset_ids: [],
          })}
        />
      </DatasetsDetailContext.Provider>,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
