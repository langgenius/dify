import { get, post } from './base'
import type {
  DataSourceNotion,
  FileUploadConfigResponse,
  Member,
  StructuredOutputRulesRequestBody,
  StructuredOutputRulesResponse,
} from '@/models/common'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { FileTypesRes } from './datasets'

const NAME_SPACE = 'common'

export const useFileUploadConfig = () => {
  return useQuery<FileUploadConfigResponse>({
    queryKey: [NAME_SPACE, 'file-upload-config'],
    queryFn: () => get<FileUploadConfigResponse>('/files/upload'),
  })
}

export const useGenerateStructuredOutputRules = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'generate-structured-output-rules'],
    mutationFn: (body: StructuredOutputRulesRequestBody) => {
      return post<StructuredOutputRulesResponse>(
        '/rule-structured-output-generate',
        { body },
      )
    },
  })
}

export const useFileSupportTypes = () => {
  return useQuery<FileTypesRes>({
    queryKey: [NAME_SPACE, 'file-types'],
    queryFn: () => get<FileTypesRes>('/files/support-type'),
  })
}

type DataSourcesResponse = {
  data: DataSourceNotion[]
}

export const useDataSources = () => {
  return useQuery<DataSourcesResponse>({
    queryKey: [NAME_SPACE, 'data-sources'],
    queryFn: () => get<DataSourcesResponse>('/data-source/integrates'),
  })
}

type MemberResponse = {
  accounts: Member[] | null
}

export const useMembers = () => {
  return useQuery<MemberResponse>({
    queryKey: [NAME_SPACE, 'members'],
    queryFn: (params: Record<string, any>) => get<MemberResponse>('/workspaces/current/members', {
      params,
    }),
  })
}
