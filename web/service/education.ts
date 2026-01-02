import type { EducationAddParams } from '@/app/education-apply/types'
import { get, post } from './base'

export type EducationVerifyResponse = { token: string }
export type EducationAddResponse = { message: string }
export type EducationAutocompleteResponse = { data: string[], has_next: boolean, curr_page: number }
export type EducationStatusResponse = { is_student: boolean, allow_refresh: boolean, expire_at: number | null }

export const verifyEducation = () => {
  return get<EducationVerifyResponse>('/account/education/verify', {}, { silent: true })
}

export const addEducation = (params: EducationAddParams) => {
  return post<EducationAddResponse>('/account/education', { body: params })
}

export const fetchEducationAutocomplete = (params: { keywords: string, page: number, limit: number }) => {
  const { keywords, page, limit } = params
  return get<EducationAutocompleteResponse>(`/account/education/autocomplete?keywords=${keywords}&page=${page}&limit=${limit}`)
}

export const fetchEducationStatus = () => {
  return get<EducationStatusResponse>('/account/education')
}
