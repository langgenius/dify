import { get, post } from './base'
import {
  useMutation,
  useQuery,
} from '@tanstack/react-query'
import { useInvalid } from './use-base'
import type { EducationAddParams } from '@/app/education-apply/components/types'

const NAME_SPACE = 'education'

export const useEducationVerify = () => {
  return useQuery({
    queryKey: [NAME_SPACE, 'education-verify'],
    queryFn: () => {
      return get<{ token: string }>('/account/education/verify')
    },
    retry: false,
  })
}

export const useEducationAdd = ({
  onSuccess,
}: {
  onSuccess?: () => void
}) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'education-add'],
    mutationFn: (params: EducationAddParams) => {
      return post<{ message: string }>('/account/education', {
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

export const useEducationStatus = (disable?: boolean) => {
  return useQuery({
    enabled: !disable,
    queryKey: [NAME_SPACE, 'education-status'],
    queryFn: () => {
      return get<{ result: boolean }>('/account/education')
    },
    retry: false,
  })
}

export const useInvalidateEducationStatus = () => {
  return useInvalid([NAME_SPACE, 'education-status'])
}
