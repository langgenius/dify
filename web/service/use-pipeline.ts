import type { MutationOptions } from '@tanstack/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { del, get, patch, post } from './base'
import type {
  DeleteTemplateResponse,
  ExportTemplateDSLResponse,
  ImportPipelineDSLConfirmResponse,
  ImportPipelineDSLRequest,
  ImportPipelineDSLResponse,
  PipelineCheckDependenciesResponse,
  PipelinePreProcessingParamsRequest,
  PipelinePreProcessingParamsResponse,
  PipelineProcessingParamsRequest,
  PipelineProcessingParamsResponse,
  PipelineTemplateByIdRequest,
  PipelineTemplateByIdResponse,
  PipelineTemplateListParams,
  PipelineTemplateListResponse,
  PublishedPipelineInfoResponse,
  PublishedPipelineRunPreviewResponse,
  PublishedPipelineRunRequest,
  PublishedPipelineRunResponse,
  UpdateTemplateInfoRequest,
  UpdateTemplateInfoResponse,
} from '@/models/pipeline'
import type { DataSourceItem } from '@/app/components/workflow/block-selector/types'
import type { ToolCredential } from '@/app/components/tools/types'
import type { IconInfo } from '@/models/datasets'

const NAME_SPACE = 'pipeline'

export const PipelineTemplateListQueryKeyPrefix = [NAME_SPACE, 'template-list']
export const usePipelineTemplateList = (params: PipelineTemplateListParams) => {
  return useQuery<PipelineTemplateListResponse>({
    queryKey: [...PipelineTemplateListQueryKeyPrefix, params.type],
    queryFn: () => {
      return get<PipelineTemplateListResponse>('/rag/pipeline/templates', { params })
    },
  })
}

export const usePipelineTemplateById = (params: PipelineTemplateByIdRequest, enabled: boolean) => {
  const { template_id, type } = params
  return useQuery<PipelineTemplateByIdResponse>({
    queryKey: [NAME_SPACE, 'template', template_id],
    queryFn: () => {
      return get<PipelineTemplateByIdResponse>(`/rag/pipeline/templates/${template_id}`, {
        params: {
          type,
        },
      })
    },
    enabled,
  })
}

export const useUpdateTemplateInfo = (
  mutationOptions: MutationOptions<UpdateTemplateInfoResponse, Error, UpdateTemplateInfoRequest> = {},
) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'template-update'],
    mutationFn: (request: UpdateTemplateInfoRequest) => {
      const { template_id, ...rest } = request
      return patch<UpdateTemplateInfoResponse>(`/rag/pipeline/customized/templates/${template_id}`, {
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
    mutationKey: [NAME_SPACE, 'template-delete'],
    mutationFn: (templateId: string) => {
      return del<DeleteTemplateResponse>(`/rag/pipeline/customized/templates/${templateId}`)
    },
    ...mutationOptions,
  })
}

export const useExportTemplateDSL = (
  mutationOptions: MutationOptions<ExportTemplateDSLResponse, Error, string> = {},
) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'template-dsl-export'],
    mutationFn: (templateId: string) => {
      return post<ExportTemplateDSLResponse>(`/rag/pipeline/customized/templates/${templateId}`)
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
      return get<PipelineCheckDependenciesResponse>(`/rag/pipelines/imports/${pipelineId}/check-dependencies`)
    },
    ...mutationOptions,
  })
}

export const useDraftPipelineProcessingParams = (params: PipelineProcessingParamsRequest, enabled = true) => {
  const { pipeline_id, node_id } = params
  return useQuery<PipelineProcessingParamsResponse>({
    queryKey: [NAME_SPACE, 'draft-pipeline-processing-params', pipeline_id, node_id],
    queryFn: () => {
      return get<PipelineProcessingParamsResponse>(`/rag/pipelines/${pipeline_id}/workflows/draft/processing/parameters`, {
        params: {
          node_id,
        },
      })
    },
    staleTime: 0,
    enabled,
  })
}

export const usePublishedPipelineProcessingParams = (params: PipelineProcessingParamsRequest) => {
  const { pipeline_id, node_id } = params
  return useQuery<PipelineProcessingParamsResponse>({
    queryKey: [NAME_SPACE, 'published-pipeline-processing-params', pipeline_id, node_id],
    queryFn: () => {
      return get<PipelineProcessingParamsResponse>(`/rag/pipelines/${pipeline_id}/workflows/published/processing/parameters`, {
        params: {
          node_id,
        },
      })
    },
    staleTime: 0,
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

export const publishedPipelineInfoQueryKeyPrefix = [NAME_SPACE, 'published-pipeline']

export const usePublishedPipelineInfo = (pipelineId: string) => {
  return useQuery<PublishedPipelineInfoResponse>({
    queryKey: [...publishedPipelineInfoQueryKeyPrefix, pipelineId],
    queryFn: () => {
      return get<PublishedPipelineInfoResponse>(`/rag/pipelines/${pipelineId}/workflows/publish`)
    },
    enabled: !!pipelineId,
  })
}

export const useRunPublishedPipeline = (
  mutationOptions: MutationOptions<PublishedPipelineRunPreviewResponse | PublishedPipelineRunResponse, Error, PublishedPipelineRunRequest> = {},
) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'run-published-pipeline'],
    mutationFn: (request: PublishedPipelineRunRequest) => {
      const { pipeline_id: pipelineId, is_preview, ...rest } = request
      return post<PublishedPipelineRunPreviewResponse | PublishedPipelineRunResponse>(`/rag/pipelines/${pipelineId}/workflows/published/run`, {
        body: {
          ...rest,
          is_preview,
          response_mode: 'blocking',
        },
      })
    },
    ...mutationOptions,
  })
}

export const useDataSourceCredentials = (provider: string, pluginId: string, onSuccess: (value: ToolCredential[]) => void) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'datasource-credentials', provider, pluginId],
    queryFn: async () => {
      const result = await get<{ result: ToolCredential[] }>(`/auth/plugin/datasource?provider=${provider}&plugin_id=${pluginId}`)
      onSuccess(result.result)
      return result.result
    },
    enabled: !!provider && !!pluginId,
    retry: 2,
  })
}

export const useUpdateDataSourceCredentials = (
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: [NAME_SPACE, 'update-datasource-credentials'],
    mutationFn: ({
      provider,
      pluginId,
      credentials,
    }: { provider: string; pluginId: string; credentials: Record<string, any>; }) => {
      return post('/auth/plugin/datasource', {
        body: {
          provider,
          plugin_id: pluginId,
          credentials,
        },
      }).then(() => {
        queryClient.invalidateQueries({
          queryKey: [NAME_SPACE, 'datasource'],
        })
      })
    },
  })
}

export const useDraftPipelinePreProcessingParams = (params: PipelinePreProcessingParamsRequest, enabled = true) => {
  const { pipeline_id, node_id } = params
  return useQuery<PipelinePreProcessingParamsResponse>({
    queryKey: [NAME_SPACE, 'draft-pipeline-pre-processing-params', pipeline_id, node_id],
    queryFn: () => {
      return get<PipelinePreProcessingParamsResponse>(`/rag/pipelines/${pipeline_id}/workflows/draft/pre-processing/parameters`, {
        params: {
          node_id,
        },
      })
    },
    staleTime: 0,
    enabled,
  })
}

export const usePublishedPipelinePreProcessingParams = (params: PipelinePreProcessingParamsRequest, enabled = true) => {
  const { pipeline_id, node_id } = params
  return useQuery<PipelinePreProcessingParamsResponse>({
    queryKey: [NAME_SPACE, 'published-pipeline-pre-processing-params', pipeline_id, node_id],
    queryFn: () => {
      return get<PipelinePreProcessingParamsResponse>(`/rag/pipelines/${pipeline_id}/workflows/published/pre-processing/parameters`, {
        params: {
          node_id,
        },
      })
    },
    staleTime: 0,
    enabled,
  })
}

export const useExportPipelineDSL = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'export-pipeline-dsl'],
    mutationFn: ({
      pipelineId,
      include = false,
    }: { pipelineId: string; include?: boolean }) => {
      return get<ExportTemplateDSLResponse>(`/rag/pipelines/${pipelineId}/exports?include_secret=${include}`)
    },
  })
}

export const usePublishAsCustomizedPipeline = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'publish-as-customized-pipeline'],
    mutationFn: ({
      pipelineId,
      name,
      icon_info,
      description,
    }: {
      pipelineId: string,
      name: string,
      icon_info: IconInfo,
      description?: string,
    }) => {
      return post(`/rag/pipelines/${pipelineId}/customized/publish`, {
        body: {
          name,
          icon_info,
          description,
        },
      })
    },
  })
}
