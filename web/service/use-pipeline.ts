import type { MutationOptions } from '@tanstack/react-query'
import type { ToolCredential } from '@/app/components/tools/types'
import type { DataSourceItem } from '@/app/components/workflow/block-selector/types'
import type { IconInfo } from '@/models/datasets'
import type {
  ConversionResponse,
  DatasourceNodeSingleRunRequest,
  DatasourceNodeSingleRunResponse,
  DeleteTemplateResponse,
  ExportTemplateDSLResponse,
  ImportPipelineDSLConfirmResponse,
  ImportPipelineDSLRequest,
  ImportPipelineDSLResponse,
  OnlineDocumentPreviewRequest,
  OnlineDocumentPreviewResponse,
  PipelineCheckDependenciesResponse,
  PipelineExecutionLogRequest,
  PipelineExecutionLogResponse,
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  checkPipelineDependencies,
  confirmImportPipelineDSL,
  convertDatasetToPipeline,
  deletePipelineTemplate,
  exportPipelineDSL,
  exportPipelineTemplateDSL,
  fetchDataSourceCredentials,
  fetchDraftPipelinePreProcessingParams,
  fetchDraftPipelineProcessingParams,
  fetchPipelineDataSourceList,
  fetchPipelineExecutionLog,
  fetchPipelineTemplateById,
  fetchPipelineTemplateList,
  fetchPublishedPipelineInfo,
  fetchPublishedPipelinePreProcessingParams,
  fetchPublishedPipelineProcessingParams,
  importPipelineDSL,
  previewOnlineDocument,
  publishAsCustomizedPipeline,
  runDatasourceNodeSingle,
  runPublishedPipeline,
  updateDataSourceCredentials,
  updatePipelineTemplateInfo,
} from './pipeline'
import { useInvalid } from './use-base'

const NAME_SPACE = 'pipeline'

export const PipelineTemplateListQueryKeyPrefix = [NAME_SPACE, 'template-list']
export const usePipelineTemplateList = (params: PipelineTemplateListParams, enabled = true) => {
  const { type, language } = params
  return useQuery<PipelineTemplateListResponse>({
    queryKey: [...PipelineTemplateListQueryKeyPrefix, type, language],
    queryFn: () => {
      return fetchPipelineTemplateList(params)
    },
    enabled,
  })
}

export const useInvalidCustomizedTemplateList = () => {
  return useInvalid([...PipelineTemplateListQueryKeyPrefix, 'customized'])
}

export const usePipelineTemplateById = (params: PipelineTemplateByIdRequest, enabled: boolean) => {
  const { template_id, type } = params
  return useQuery<PipelineTemplateByIdResponse>({
    queryKey: [NAME_SPACE, 'template', type, template_id],
    queryFn: () => {
      return fetchPipelineTemplateById(params)
    },
    enabled,
    staleTime: 0,
  })
}

export const useUpdateTemplateInfo = (
  mutationOptions: MutationOptions<UpdateTemplateInfoResponse, Error, UpdateTemplateInfoRequest> = {},
) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'template-update'],
    mutationFn: (request: UpdateTemplateInfoRequest) => {
      return updatePipelineTemplateInfo(request)
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
      return deletePipelineTemplate(templateId)
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
      return exportPipelineTemplateDSL(templateId)
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
      return importPipelineDSL(request)
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
      return confirmImportPipelineDSL(importId)
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
      return checkPipelineDependencies(pipelineId)
    },
    ...mutationOptions,
  })
}

export const useDraftPipelineProcessingParams = (params: PipelineProcessingParamsRequest, enabled = true) => {
  const { pipeline_id, node_id } = params
  return useQuery<PipelineProcessingParamsResponse>({
    queryKey: [NAME_SPACE, 'draft-pipeline-processing-params', pipeline_id, node_id],
    queryFn: () => {
      return fetchDraftPipelineProcessingParams(params)
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
      return fetchPublishedPipelineProcessingParams(params)
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
      const data = await fetchPipelineDataSourceList()
      onSuccess?.(data)
      return data
    },
    retry: false,
  })
}

export const useInvalidDataSourceList = () => {
  return useInvalid([NAME_SPACE, 'datasource'])
}

export const publishedPipelineInfoQueryKeyPrefix = [NAME_SPACE, 'published-pipeline']

export const usePublishedPipelineInfo = (pipelineId: string) => {
  return useQuery<PublishedPipelineInfoResponse>({
    queryKey: [...publishedPipelineInfoQueryKeyPrefix, pipelineId],
    queryFn: () => {
      return fetchPublishedPipelineInfo(pipelineId)
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
      return runPublishedPipeline(request)
    },
    ...mutationOptions,
  })
}

export const useDataSourceCredentials = (provider: string, pluginId: string, onSuccess: (value: ToolCredential[]) => void) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'datasource-credentials', provider, pluginId],
    queryFn: async () => {
      const result = await fetchDataSourceCredentials(provider, pluginId)
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
      name,
    }: { provider: string, pluginId: string, credentials: Record<string, any>, name: string }) => {
      return updateDataSourceCredentials({ provider, pluginId, credentials, name }).then(() => {
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
      return fetchDraftPipelinePreProcessingParams(params)
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
      return fetchPublishedPipelinePreProcessingParams(params)
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
    }: { pipelineId: string, include?: boolean }) => {
      return exportPipelineDSL(pipelineId, include)
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
      pipelineId: string
      name: string
      icon_info: IconInfo
      description?: string
    }) => {
      return publishAsCustomizedPipeline({ pipelineId, name, icon_info, description })
    },
  })
}

export const usePipelineExecutionLog = (params: PipelineExecutionLogRequest) => {
  const { dataset_id, document_id } = params
  return useQuery<PipelineExecutionLogResponse>({
    queryKey: [NAME_SPACE, 'pipeline-execution-log', dataset_id, document_id],
    queryFn: () => {
      return fetchPipelineExecutionLog(params)
    },
    staleTime: 0,
  })
}

export const usePreviewOnlineDocument = () => {
  return useMutation<OnlineDocumentPreviewResponse, Error, OnlineDocumentPreviewRequest>({
    mutationKey: [NAME_SPACE, 'preview-online-document'],
    mutationFn: (params: OnlineDocumentPreviewRequest) => {
      return previewOnlineDocument(params)
    },
  })
}

export const useConvertDatasetToPipeline = () => {
  return useMutation<ConversionResponse, Error, string>({
    mutationKey: [NAME_SPACE, 'convert-dataset-to-pipeline'],
    mutationFn: (datasetId: string) => {
      return convertDatasetToPipeline(datasetId)
    },
  })
}

export const useDatasourceSingleRun = (
  mutationOptions: MutationOptions<DatasourceNodeSingleRunResponse, Error, DatasourceNodeSingleRunRequest> = {},
) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'datasource-node-single-run'],
    mutationFn: (params: DatasourceNodeSingleRunRequest) => {
      return runDatasourceNodeSingle(params)
    },
    ...mutationOptions,
  })
}
