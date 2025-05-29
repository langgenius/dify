import type { MutationOptions } from '@tanstack/react-query'
import { useMutation, useQuery } from '@tanstack/react-query'
import { del, get, patch, post } from './base'
import type {
  DeleteTemplateResponse,
  ExportTemplateDSLResponse,
  ImportPipelineDSLConfirmResponse,
  ImportPipelineDSLRequest,
  ImportPipelineDSLResponse,
  PipelineCheckDependenciesResponse,
  PipelineDatasourceNodeRunRequest,
  PipelineDatasourceNodeRunResponse,
  PipelineProcessingParamsRequest,
  PipelineProcessingParamsResponse,
  PipelineTemplateByIdResponse,
  PipelineTemplateListParams,
  PipelineTemplateListResponse,
  PublishedPipelineInfoResponse,
  PublishedPipelineRunRequest,
  UpdateTemplateInfoRequest,
  UpdateTemplateInfoResponse,
} from '@/models/pipeline'
import type { DataSourceItem } from '@/app/components/workflow/block-selector/types'

const NAME_SPACE = 'pipeline'

export const usePipelineTemplateList = (params: PipelineTemplateListParams) => {
  return useQuery<PipelineTemplateListResponse>({
    queryKey: [NAME_SPACE, 'template', 'list'],
    queryFn: () => {
      return get<PipelineTemplateListResponse>('/rag/pipeline/templates', { params })
    },
  })
}

export const usePipelineTemplateById = (templateId: string, enabled: boolean) => {
  return useQuery<PipelineTemplateByIdResponse>({
    queryKey: [NAME_SPACE, 'template', templateId],
    queryFn: () => {
      return get<PipelineTemplateByIdResponse>(`/rag/pipeline/templates/${templateId}`)
    },
    enabled,
  })
}

export const useUpdateTemplateInfo = (
  mutationOptions: MutationOptions<UpdateTemplateInfoResponse, Error, UpdateTemplateInfoRequest> = {},
) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'template', 'update'],
    mutationFn: (request: UpdateTemplateInfoRequest) => {
      const { template_id, ...rest } = request
      return patch<UpdateTemplateInfoResponse>(`/rag/customized/templates/${template_id}`, {
        body: rest,
      })
    },
    ...mutationOptions,
  })
}

export const useDeleteTemplate = (
  mutationOptions: MutationOptions<DeleteTemplateResponse, Error, string> = {},
) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'template', 'delete'],
    mutationFn: (templateId: string) => {
      return del<DeleteTemplateResponse>(`/rag/customized/templates/${templateId}`)
    },
    ...mutationOptions,
  })
}

export const useExportTemplateDSL = (
  mutationOptions: MutationOptions<ExportTemplateDSLResponse, Error, string> = {},
) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'dsl-export'],
    mutationFn: (templateId: string) => {
      return get<ExportTemplateDSLResponse>(`/rag/customized/templates/${templateId}`)
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
      return post<ImportPipelineDSLResponse>('/rag/pipelines/imports', { body: request })
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
      return post<ImportPipelineDSLConfirmResponse>(`/rag/pipelines/imports/${importId}/confirm`)
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

export const useDatasourceNodeRun = (
  mutationOptions: MutationOptions<PipelineDatasourceNodeRunResponse, Error, PipelineDatasourceNodeRunRequest> = {},
) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'datasource-node-run'],
    mutationFn: (request: PipelineDatasourceNodeRunRequest) => {
      const { pipeline_id, node_id, ...rest } = request
      return post<PipelineDatasourceNodeRunResponse>(`/rag/pipelines/${pipeline_id}/workflows/published/nodes/${node_id}/run`, {
        body: rest,
      })
    },
    ...mutationOptions,
  })
}

export const useDraftPipelineProcessingParams = (params: PipelineProcessingParamsRequest) => {
  const { pipeline_id, node_id } = params
  return useQuery<PipelineProcessingParamsResponse>({
    queryKey: [NAME_SPACE, 'pipeline-processing-params', pipeline_id],
    queryFn: () => {
      return get<PipelineProcessingParamsResponse>(`/rag/pipelines/${pipeline_id}/workflows/draft/processing/parameters`, {
        params: {
          node_id,
        },
      })
    },
    staleTime: 0,
  })
}

export const usePublishedPipelineProcessingParams = (params: PipelineProcessingParamsRequest) => {
  const { pipeline_id, node_id } = params
  return useQuery<PipelineProcessingParamsResponse>({
    queryKey: [NAME_SPACE, 'pipeline-processing-params', pipeline_id],
    queryFn: () => {
      return get<PipelineProcessingParamsResponse>(`/rag/pipelines/${pipeline_id}/workflows/published/processing/parameters`, {
        params: {
          node_id,
        },
      })
    },
  })
}

export const useDataSourceList = (enabled: boolean, onSuccess?: (v: DataSourceItem[]) => void) => {
  return useQuery<DataSourceItem[]>({
    enabled,
    queryKey: [NAME_SPACE, 'datasource'],
    staleTime: 0,
    queryFn: async () => {
      const data = await get<DataSourceItem[]>('/rag/pipelines/datasource-plugins')
      onSuccess?.(data)
      return data
    },
    retry: false,
  })
}

export const usePublishedPipelineInfo = (pipelineId: string) => {
  return useQuery<PublishedPipelineInfoResponse>({
    queryKey: [NAME_SPACE, 'published-pipeline', pipelineId],
    queryFn: () => {
      return get<PublishedPipelineInfoResponse>(`/rag/pipelines/${pipelineId}/workflows/publish`)
    },
    enabled: !!pipelineId,
  })
}

export const useRunPublishedPipeline = (
  mutationOptions: MutationOptions<any, Error, PublishedPipelineRunRequest> = {},
) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'run-published-pipeline'],
    mutationFn: (request: PublishedPipelineRunRequest) => {
      const { pipeline_id: pipelineId, ...rest } = request
      return post<PublishedPipelineInfoResponse>(`/rag/pipelines/${pipelineId}/workflows/published/run`, {
        body: {
          ...rest,
          response_mode: 'blocking',
        },
      })
    },
    ...mutationOptions,
  })
}
