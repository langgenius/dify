import {
  useCallback,
  useState,
} from 'react'
import { useDebounceFn } from 'ahooks'
import type { SearchParams } from './types'
import { useEducationAutocomplete } from '@/service/use-education'

export const useEducation = () => {
  const {
    mutateAsync,
    isPending,
  } = useEducationAutocomplete()

  const [prevSchools, setPrevSchools] = useState<string[]>([])
  const handleUpdateSchools = useCallback((searchParams: SearchParams) => {
    if (searchParams.keywords) {
      mutateAsync(searchParams).then((res) => {
        const currentPage = searchParams.page || 1
        const resSchools = res.data
        if (currentPage > 1)
          setPrevSchools(prevSchools => [...(prevSchools || []), ...resSchools])
        else
          setPrevSchools(resSchools)
      })
    }
  }, [mutateAsync])

  const { run: querySchoolsWithDebounced } = useDebounceFn((searchParams: SearchParams) => {
    handleUpdateSchools(searchParams)
  }, {
    wait: 1000,
  })

  return {
    schools: prevSchools,
    querySchoolsWithDebounced,
    isLoading: isPending,
  }
}
