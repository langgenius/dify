import { get, post } from './base'
import {
  useMutation,
} from '@tanstack/react-query'
import type { EducationAddParams } from '@/app/education-apply/components/types'

const NAME_SPACE = 'education'

export const useEducationAdd = ({
  onSuccess,
}: {
  onSuccess?: () => void
}) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'education-add'],
    mutationFn: (params: EducationAddParams) => {
      return post('/account/education/add', {
        body: params,
      })
    },
    onSuccess,
  })
}

type SearchParams = {
  keywords?: string
  page?: number
  limit?: number
}
export const useEducationAutocomplete = () => {
  return useMutation({
    mutationFn: (searchParams: SearchParams) => {
      const {
        keywords = '',
        page = 1,
        limit = 20,
      } = searchParams
      return get<{ data: string[]; has_next: boolean; curr_page: number }>(`/account/education/autocomplete?keywords=${keywords}&page=${page}&limit=${limit}`)
    },
  })
}
