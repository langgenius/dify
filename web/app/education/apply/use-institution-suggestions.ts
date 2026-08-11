import { useDebounceFn } from 'ahooks'
import { useCallback, useState } from 'react'
import { useEducationAutocomplete } from '@/service/use-education'

type InstitutionSuggestionsRequest = {
  query: string
  page: number
}

export const useInstitutionSuggestions = () => {
  const { mutateAsync, isPending, data } = useEducationAutocomplete()
  const [suggestions, setSuggestions] = useState<string[]>([])

  const clearSuggestions = useCallback(() => {
    setSuggestions([])
  }, [])

  const requestSuggestions = useCallback(
    ({ query, page }: InstitutionSuggestionsRequest) => {
      if (!query) return

      mutateAsync({ keywords: query, page }).then((response) => {
        setSuggestions((currentSuggestions) =>
          page > 0 ? [...currentSuggestions, ...response.data] : response.data,
        )
      })
    },
    [mutateAsync],
  )

  const { run: requestSuggestionsDebounced } = useDebounceFn(requestSuggestions, {
    wait: 300,
  })

  return {
    suggestions,
    clearSuggestions,
    requestSuggestions,
    requestSuggestionsDebounced,
    isPending,
    hasNextPage: data?.has_next ?? false,
  }
}
