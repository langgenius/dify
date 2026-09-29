import type { RagPipelineSliceShape } from '../index'
import { createStore } from 'zustand/vanilla'
import { createDatasourceProvider } from '../../__tests__/datasource-fixtures'
import { createRagPipelineSliceSlice } from '../index'

it('stores the datasource domain unchanged and replaces it on catalog refresh', () => {
  const store = createStore<RagPipelineSliceShape>()(createRagPipelineSliceSlice)
  const provider = createDatasourceProvider({ is_authorized: false })

  store.getState().setDataSourceList([provider])

  expect(store.getState().dataSourceList).toEqual([provider])
  expect(store.getState().dataSourceList[0]).not.toHaveProperty('tools')
  expect(store.getState().dataSourceList[0]?.declaration.identity.icon).toBe('/datasource.svg')

  const authorized = { ...provider, is_authorized: true }
  store.getState().setDataSourceList([authorized])
  expect(store.getState().dataSourceList).toEqual([authorized])
  expect(provider.is_authorized).toBe(false)
  store.getState().setDataSourceList([])
  expect(store.getState().dataSourceList).toEqual([])
})
