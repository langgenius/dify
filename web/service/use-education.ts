import type { EducationAddParams } from '@/app/education-apply/types'
import {
  useMutation,
  useQuery,
} from '@tanstack/react-query'
import {
  addEducation,
  fetchEducationAutocomplete,
  fetchEducationStatus,
  verifyEducation,
} from './education'
import { useInvalid } from './use-base'

const NAME_SPACE = 'education'

export const useEducationVerify = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'education-verify'],
    mutationFn: () => {
      return verifyEducation()
    },
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
      return addEducation(params)
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
        page = 0,
        limit = 40,
      } = searchParams
      return fetchEducationAutocomplete({ keywords, page, limit })
    },
  })
}

export const useEducationStatus = (disable?: boolean) => {
  return useQuery({
    enabled: !disable,
    queryKey: [NAME_SPACE, 'education-status'],
    queryFn: () => {
      return fetchEducationStatus()
    },
    retry: false,
    staleTime: 0, // Data expires immediately, ensuring fresh data on refetch
  })
}

export const useInvalidateEducationStatus = () => {
  return useInvalid([NAME_SPACE, 'education-status'])
}
