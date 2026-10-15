import type { MutationOptions } from '@tanstack/react-query'
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
import { useMutation, useQuery } from '@tanstack/react-query'
import { DatasourceType } from '@/models/pipeline'
import { consoleClient } from './console'
import { narrowResponse } from './console/narrow-response'
import { useInvalid } from './use-base'

const NAME_SPACE = 'pipeline'

const PipelineTemplateListQueryKeyPrefix = [NAME_SPACE, 'template-list']
export const usePipelineTemplateList = (params: PipelineTemplateListParams, enabled = true) => {
  return useQuery<PipelineTemplateListResponse>({
    queryKey: [...PipelineTemplateListQueryKeyPrefix, params],
    queryFn: () => {
      return narrowResponse<PipelineTemplateListResponse>(
        consoleClient.rag.pipeline.templates.get({ query: params }),
      )
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
      return narrowResponse<PipelineTemplateByIdResponse>(
        consoleClient.rag.pipeline.templates.byTemplateId.get({
          params: { template_id },
          query: {
            type,
          },
        }),
      )
    },
    enabled,
    staleTime: 0,
  })
}

export const useUpdateTemplateInfo = (
  mutationOptions: MutationOptions<
    UpdateTemplateInfoResponse,
    Error,
    UpdateTemplateInfoRequest
  > = {},
) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'template-update'],
    mutationFn: (request: UpdateTemplateInfoRequest) => {
      const { template_id, ...rest } = request
      return narrowResponse<UpdateTemplateInfoResponse>(
        consoleClient.rag.pipeline.customized.templates.byTemplateId.patch({
          params: { template_id },
          body: rest,
        }),
      )
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
      return narrowResponse<DeleteTemplateResponse>(
        consoleClient.rag.pipeline.customized.templates.byTemplateId.delete({
          params: { template_id: templateId },
        }),
      )
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
      return narrowResponse<ExportTemplateDSLResponse>(
        consoleClient.rag.pipeline.customized.templates.byTemplateId.post({
          params: { template_id: templateId },
        }),
      )
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
      return narrowResponse<ImportPipelineDSLResponse>(
        consoleClient.rag.pipelines.imports.post({ body: request }, { context: { silent: true } }),
      )
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
      return narrowResponse<ImportPipelineDSLConfirmResponse>(
        consoleClient.rag.pipelines.imports.byImportId.confirm.post(
          { params: { import_id: importId } },
          { context: { silent: true } },
        ),
      )
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
      return narrowResponse<PipelineCheckDependenciesResponse>(
        consoleClient.rag.pipelines.imports.byPipelineId.checkDependencies.get({
          params: { pipeline_id: pipelineId },
        }),
      )
    },
    ...mutationOptions,
  })
}

export const useDraftPipelineProcessingParams = (
  params: PipelineProcessingParamsRequest,
  enabled = true,
) => {
  const { pipeline_id, node_id } = params
  return useQuery<PipelineProcessingParamsResponse>({
    queryKey: [NAME_SPACE, 'draft-pipeline-processing-params', pipeline_id, node_id],
    queryFn: () => {
      return narrowResponse<PipelineProcessingParamsResponse>(
        consoleClient.rag.pipelines.byPipelineId.workflows.draft.processing.parameters.get({
          params: { pipeline_id },
          query: {
            node_id,
          },
        }),
      )
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
      return narrowResponse<PipelineProcessingParamsResponse>(
        consoleClient.rag.pipelines.byPipelineId.workflows.published.processing.parameters.get({
          params: { pipeline_id },
          query: {
            node_id,
          },
        }),
      )
    },
    staleTime: 0,
  })
}

export const publishedPipelineInfoQueryKeyPrefix = [NAME_SPACE, 'published-pipeline']

export const usePublishedPipelineInfo = (pipelineId: string) => {
  return useQuery<PublishedPipelineInfoResponse | null>({
    queryKey: [...publishedPipelineInfoQueryKeyPrefix, pipelineId],
    queryFn: () => {
      return narrowResponse<PublishedPipelineInfoResponse | null>(
        consoleClient.rag.pipelines.byPipelineId.workflows.publish.get({
          params: { pipeline_id: pipelineId },
        }),
      )
    },
    enabled: !!pipelineId,
  })
}

export const useRunPublishedPipeline = (
  mutationOptions: MutationOptions<
    PublishedPipelineRunPreviewResponse | PublishedPipelineRunResponse,
    Error,
    PublishedPipelineRunRequest
  > = {},
) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'run-published-pipeline'],
    mutationFn: (request: PublishedPipelineRunRequest) => {
      const { pipeline_id: pipelineId, is_preview, ...rest } = request
      return narrowResponse<PublishedPipelineRunPreviewResponse | PublishedPipelineRunResponse>(
        consoleClient.rag.pipelines.byPipelineId.workflows.published.run.post({
          params: { pipeline_id: pipelineId },
          body: {
            ...rest,
            is_preview,
            response_mode: 'blocking',
          },
        }),
      )
    },
    ...mutationOptions,
  })
}

export const useDraftPipelinePreProcessingParams = (
  params: PipelinePreProcessingParamsRequest,
  enabled = true,
) => {
  const { pipeline_id, node_id } = params
  return useQuery<PipelinePreProcessingParamsResponse>({
    queryKey: [NAME_SPACE, 'draft-pipeline-pre-processing-params', pipeline_id, node_id],
    queryFn: () => {
      return narrowResponse<PipelinePreProcessingParamsResponse>(
        consoleClient.rag.pipelines.byPipelineId.workflows.draft.preProcessing.parameters.get({
          params: { pipeline_id },
          query: {
            node_id,
          },
        }),
      )
    },
    staleTime: 0,
    enabled,
  })
}

export const usePublishedPipelinePreProcessingParams = (
  params: PipelinePreProcessingParamsRequest,
  enabled = true,
) => {
  const { pipeline_id, node_id } = params
  return useQuery<PipelinePreProcessingParamsResponse>({
    queryKey: [NAME_SPACE, 'published-pipeline-pre-processing-params', pipeline_id, node_id],
    queryFn: () => {
      return narrowResponse<PipelinePreProcessingParamsResponse>(
        consoleClient.rag.pipelines.byPipelineId.workflows.published.preProcessing.parameters.get({
          params: { pipeline_id },
          query: {
            node_id,
          },
        }),
      )
    },
    staleTime: 0,
    enabled,
  })
}

export const useExportPipelineDSL = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'export-pipeline-dsl'],
    mutationFn: ({ pipelineId, include = false }: { pipelineId: string; include?: boolean }) => {
      return narrowResponse<ExportTemplateDSLResponse>(
        consoleClient.rag.pipelines.byPipelineId.exports.get({
          params: { pipeline_id: pipelineId },
          query: { include_secret: String(include) },
        }),
      )
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
      return consoleClient.rag.pipelines.byPipelineId.customized.publish.post({
        params: { pipeline_id: pipelineId },
        body: {
          name,
          icon_info,
          description,
        },
      })
    },
  })
}

export const usePipelineExecutionLog = (params: PipelineExecutionLogRequest) => {
  const { dataset_id, document_id } = params
  return useQuery<PipelineExecutionLogResponse>({
    queryKey: [NAME_SPACE, 'pipeline-execution-log', dataset_id, document_id],
    queryFn: () => {
      return narrowResponse<PipelineExecutionLogResponse>(
        consoleClient.datasets.byDatasetId.documents.byDocumentId.pipelineExecutionLog.get({
          params: { dataset_id, document_id },
        }),
      )
    },
    staleTime: 0,
  })
}

export const usePreviewOnlineDocument = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'preview-online-document'],
    mutationFn: (params: OnlineDocumentPreviewRequest) => {
      const { pipelineId, datasourceNodeId, workspaceID, pageID, pageType, credentialId } = params
      return narrowResponse<OnlineDocumentPreviewResponse>(
        consoleClient.rag.pipelines.byPipelineId.workflows.published.datasource.nodes.byNodeId.preview.post(
          {
            params: { pipeline_id: pipelineId, node_id: datasourceNodeId },
            body: {
              datasource_type: DatasourceType.onlineDocument,
              credential_id: credentialId,
              inputs: {
                workspace_id: workspaceID,
                page_id: pageID,
                type: pageType,
              },
            },
          },
        ),
      )
    },
  })
}

export const useConvertDatasetToPipeline = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'convert-dataset-to-pipeline'],
    mutationFn: (datasetId: string) => {
      return narrowResponse<ConversionResponse>(
        consoleClient.rag.pipelines.transform.datasets.byDatasetId.post({
          params: { dataset_id: datasetId },
        }),
      )
    },
  })
}

export const useDatasourceSingleRun = (
  mutationOptions: MutationOptions<
    DatasourceNodeSingleRunResponse,
    Error,
    DatasourceNodeSingleRunRequest
  > = {},
) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'datasource-node-single-run'],
    mutationFn: (params: DatasourceNodeSingleRunRequest) => {
      const { pipeline_id: pipelineId, ...rest } = params
      return narrowResponse<DatasourceNodeSingleRunResponse>(
        consoleClient.rag.pipelines.byPipelineId.workflows.draft.datasource.variablesInspect.post({
          params: { pipeline_id: pipelineId },
          body: rest,
        }),
      )
    },
    ...mutationOptions,
  })
}
