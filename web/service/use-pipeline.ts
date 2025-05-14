import type { MutationOptions } from '@tanstack/react-query'
import { useMutation, useQuery } from '@tanstack/react-query'
import { del, get, patch, post } from './base'
import type {
  DeletePipelineResponse,
  ExportPipelineDSLRequest,
  ExportPipelineDSLResponse,
  ImportPipelineDSLConfirmResponse,
  ImportPipelineDSLRequest,
  ImportPipelineDSLResponse,
  PipelineCheckDependenciesResponse,
  PipelineProcessingParamsResponse,
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
  mutationOptions: MutationOptions<ExportPipelineDSLResponse, Error, ExportPipelineDSLRequest> = {},
) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'dsl-export'],
    mutationFn: (request: ExportPipelineDSLRequest) => {
      return get<ExportPipelineDSLResponse>(`/rag/pipeline/${request.pipeline_id}/export`, {
        params: {
          include_secret: !!request.include_secret,
        },
      })
    },
    ...mutationOptions,
  })
}

export const useImportPipelineDSL = (
  mutationOptions: MutationOptions<ImportPipelineDSLResponse, Error, ImportPipelineDSLRequest> = {},
) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'dsl-import'],
    mutationFn: (request: ImportPipelineDSLRequest) => {
      return post<ImportPipelineDSLResponse>('/rag/pipeline/imports', { body: request })
    },
    ...mutationOptions,
  })
}

export const useImportPipelineDSLConfirm = (
  mutationOptions: MutationOptions<ImportPipelineDSLConfirmResponse, Error, string> = {},
) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'dsl-import-confirm'],
    mutationFn: (importId: string) => {
      return post<ImportPipelineDSLConfirmResponse>(`/rag/pipeline/imports/${importId}/confirm`)
    },
    ...mutationOptions,
  })
}

export const useCheckPipelineDependencies = (
  mutationOptions: MutationOptions<PipelineCheckDependenciesResponse, Error, string> = {},
) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'check-dependencies'],
    mutationFn: (pipelineId: string) => {
      return post<PipelineCheckDependenciesResponse>(`/rag/pipelines/imports/${pipelineId}/check-dependencies`)
    },
    ...mutationOptions,
  })
}

// Get the config of shared input fields
export const usePipelineProcessingParams = (pipelineId: string) => {
  return useQuery<PipelineProcessingParamsResponse>({
    queryKey: [NAME_SPACE, 'pipeline-processing-params', pipelineId],
    queryFn: () => {
      return get<PipelineProcessingParamsResponse>(`/rag/pipeline/${pipelineId}/workflows/processing/parameters`)
    },
  })
}
