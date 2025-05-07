import type { MutationOptions } from '@tanstack/react-query'
import { useMutation, useQuery } from '@tanstack/react-query'
import { del, get, patch, post } from './base'
import type {
  DeletePipelineResponse,
  ExportPipelineDSLResponse,
  ImportPipelineDSLRequest,
  ImportPipelineDSLResponse,
  PipelineTemplateByIdResponse,
  PipelineTemplateListParams,
  PipelineTemplateListResponse,
  UpdatePipelineInfoRequest,
  UpdatePipelineInfoResponse,
} from '@/models/pipeline'

const NAME_SPACE = 'pipeline'

export const usePipelineTemplateList = (params: PipelineTemplateListParams) => {
  return useQuery<PipelineTemplateListResponse>({
    queryKey: [NAME_SPACE, 'template', 'list'],
    queryFn: () => {
      return get<PipelineTemplateListResponse>('/rag/pipeline/template', { params })
    },
  })
}

export const usePipelineTemplateById = (templateId: string, enabled: boolean) => {
  return useQuery<PipelineTemplateByIdResponse>({
    queryKey: [NAME_SPACE, 'template', templateId],
    queryFn: () => {
      return get<PipelineTemplateByIdResponse>(`/rag/pipeline/template/${templateId}`)
    },
    enabled,
  })
}

export const useUpdatePipelineInfo = (
  mutationOptions: MutationOptions<UpdatePipelineInfoResponse, Error, UpdatePipelineInfoRequest> = {},
) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'template', 'update'],
    mutationFn: (request: UpdatePipelineInfoRequest) => {
      const { pipeline_id, ...rest } = request
      return patch<UpdatePipelineInfoResponse>(`/rag/pipeline/${pipeline_id}`, {
        body: rest,
      })
    },
    ...mutationOptions,
  })
}

export const useDeletePipeline = (
  mutationOptions: MutationOptions<DeletePipelineResponse, Error, string> = {},
) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'template', 'delete'],
    mutationFn: (pipelineId: string) => {
      return del<DeletePipelineResponse>(`/rag/pipeline/${pipelineId}`)
    },
    ...mutationOptions,
  })
}

export const useExportPipelineDSL = (
  mutationOptions: MutationOptions<ExportPipelineDSLResponse, Error, string> = {},
) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'template', 'export'],
    mutationFn: (pipelineId: string) => {
      return get<ExportPipelineDSLResponse>(`/rag/pipeline/${pipelineId}`)
    },
    ...mutationOptions,
  })
}

// TODO: replace with real API
export const useImportPipelineDSL = (
  mutationOptions: MutationOptions<ImportPipelineDSLResponse, Error, ImportPipelineDSLRequest> = {},
) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'template', 'import'],
    mutationFn: (request: ImportPipelineDSLRequest) => {
      return post<ImportPipelineDSLResponse>('/rag/pipeline/import', { body: request })
    },
    ...mutationOptions,
  })
}
