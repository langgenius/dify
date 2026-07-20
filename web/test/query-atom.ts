import { createStore } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import { createTestQueryClient } from '@/test/query-client'

export const createQueryAtomTestStore = () => {
  const queryClient = createTestQueryClient()
  const store = createStore()
  store.set(queryClientAtom, queryClient)

  return { queryClient, store }
}
