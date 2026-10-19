import { createDatasetFixture } from '@/test/fixtures/dataset'
import { createDatasetsDetailStore } from '../store'

const createDataset = (id: string, name: string) => createDatasetFixture({ id, name })

describe('datasets-detail-store', () => {
  it('merges dataset details by id', () => {
    const store = createDatasetsDetailStore()

    store
      .getState()
      .updateDatasetsDetail([
        createDataset('dataset-1', 'Dataset One'),
        createDataset('dataset-2', 'Dataset Two'),
      ])
    store.getState().updateDatasetsDetail([createDataset('dataset-2', 'Dataset Two Updated')])

    expect(store.getState().datasetsDetail).toMatchObject({
      'dataset-1': { name: 'Dataset One' },
      'dataset-2': { name: 'Dataset Two Updated' },
    })
  })
})
