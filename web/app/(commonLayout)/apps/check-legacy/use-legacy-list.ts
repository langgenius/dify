import produce from 'immer'
import { useCallback, useState } from 'react'

const useLegacyList = () => {
  const [queryParams, setQueryParams] = useState<Record<string, any>>({})
  const {
    sort_by,
    published,
  } = queryParams
  const setOrderBy = useCallback((sortBy: string) => {
    const nextValue = produce(queryParams, (draft) => {
      draft.sort_by = sortBy
    })
    setQueryParams(nextValue)
  }, [queryParams])

  const setPublished = useCallback((value: number) => {
    const nextValue = produce(queryParams, (draft) => {
      draft.published = value
    })
    setQueryParams(nextValue)
  }, [queryParams])

  const clearPublished = useCallback(() => {
    const nextValue = produce(queryParams, (draft) => {
      draft.published = undefined
    })
    setQueryParams(nextValue)
  }, [queryParams])

  return {
    sort_by,
    setOrderBy,
    published,
    setPublished,
    clearPublished,
  }
}

export default useLegacyList
