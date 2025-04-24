import { get, post } from './base'
import type {
  DataSourceNotion,
  FileUploadConfigResponse,
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
