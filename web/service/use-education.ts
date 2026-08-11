import { useMutation } from '@tanstack/react-query'
import { consoleClient } from './client'

const NAME_SPACE = 'education'

export const useEducationVerify = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'education-verify'],
    mutationFn: async () => {
      const response = await consoleClient.account.education.verify.get(
        {},
        { context: { silent: true } },
      )
      if (!response.token) throw new Error('Education verification token is missing')

      return { token: response.token }
    },
  })
}

type SearchParams = {
  keywords?: string
  page?: number
  limit?: number
}
export const useEducationAutocomplete = () => {
  return useMutation({
    mutationFn: async (searchParams: SearchParams) => {
      const { keywords = '', page = 0, limit = 40 } = searchParams
      const response = await consoleClient.account.education.autocomplete.get({
        query: { keywords, limit, page },
      })

      return {
        curr_page: response.curr_page ?? page,
        data: response.data ?? [],
        has_next: response.has_next ?? false,
      }
    },
  })
}
