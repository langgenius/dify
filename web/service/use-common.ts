import { get, post } from './base'
import type {
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

type FilePreviewResponse = {
  content: string
}

export const useFilePreview = (fileID: string) => {
  return useQuery<FilePreviewResponse>({
    queryKey: [NAME_SPACE, 'file-preview', fileID],
    queryFn: () => get<FilePreviewResponse>(`/files/${fileID}/preview`),
    enabled: !!fileID,
  })
}

export type SchemaTypeDefinition = {
  name: string
  schema: {
    properties: Record<string, any>
  }
}

export const useSchemaTypeDefinitions = () => {
  return useQuery<SchemaTypeDefinition[]>({
    queryKey: [NAME_SPACE, 'schema-type-definitions'],
    queryFn: () => get<SchemaTypeDefinition[]>('/spec/schema-definitions'),
  })
}
