import type { DataSet } from '@/models/datasets'
import { createDatasetsDetailStore } from '../../datasets-detail-store/store'

function makeDataset(id: string, name: string): DataSet {
  return { id, name } as DataSet
}

describe('DatasetsDetailStore', () => {
  describe('Initial State', () => {
    it('should start with empty datasetsDetail', () => {
      const store = createDatasetsDetailStore()
      expect(store.getState().datasetsDetail).toEqual({})
    })
  })

  describe('updateDatasetsDetail', () => {
    it('should add datasets by id', () => {
      const store = createDatasetsDetailStore()
      const ds1 = makeDataset('ds-1', 'Dataset 1')
      const ds2 = makeDataset('ds-2', 'Dataset 2')

      store.getState().updateDatasetsDetail([ds1, ds2])

      expect(store.getState().datasetsDetail['ds-1']).toEqual(ds1)
      expect(store.getState().datasetsDetail['ds-2']).toEqual(ds2)
    })

    it('should merge new datasets into existing ones', () => {
      const store = createDatasetsDetailStore()
      const ds1 = makeDataset('ds-1', 'First')
      const ds2 = makeDataset('ds-2', 'Second')
      const ds3 = makeDataset('ds-3', 'Third')

      store.getState().updateDatasetsDetail([ds1, ds2])
      store.getState().updateDatasetsDetail([ds3])

      const detail = store.getState().datasetsDetail
      expect(detail['ds-1']).toEqual(ds1)
      expect(detail['ds-2']).toEqual(ds2)
      expect(detail['ds-3']).toEqual(ds3)
    })

    it('should overwrite existing datasets with same id', () => {
      const store = createDatasetsDetailStore()
      const ds1v1 = makeDataset('ds-1', 'Version 1')
      const ds1v2 = makeDataset('ds-1', 'Version 2')

      store.getState().updateDatasetsDetail([ds1v1])
      store.getState().updateDatasetsDetail([ds1v2])

      expect(store.getState().datasetsDetail['ds-1']!.name).toBe('Version 2')
    })

    it('should handle empty array without errors', () => {
      const store = createDatasetsDetailStore()
      store.getState().updateDatasetsDetail([makeDataset('ds-1', 'Test')])
      store.getState().updateDatasetsDetail([])

      expect(store.getState().datasetsDetail['ds-1']!.name).toBe('Test')
    })
  })
})
