import type { ToolCredential } from '@/app/components/tools/types'
import type { DataSourceItem } from '@/app/components/workflow/block-selector/types'
import type { CreateDatasetReq, CreateDatasetResponse, IconInfo } from '@/models/datasets'
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
import { DatasourceType } from '@/models/pipeline'
import { del, get, patch, post } from './base'

export const fetchPipelineTemplateList = (params: PipelineTemplateListParams) => {
  return get<PipelineTemplateListResponse>('/rag/pipeline/templates', { params })
}

export const fetchPipelineTemplateById = (params: PipelineTemplateByIdRequest) => {
  const { template_id, type } = params
  return get<PipelineTemplateByIdResponse>(`/rag/pipeline/templates/${template_id}`, {
    params: {
      type,
    },
  })
}

export const updatePipelineTemplateInfo = (request: UpdateTemplateInfoRequest) => {
  const { template_id, ...rest } = request
  return patch<UpdateTemplateInfoResponse>(`/rag/pipeline/customized/templates/${template_id}`, {
    body: rest,
  })
}

export const deletePipelineTemplate = (templateId: string) => {
  return del<DeleteTemplateResponse>(`/rag/pipeline/customized/templates/${templateId}`)
}

export const exportPipelineTemplateDSL = (templateId: string) => {
  return post<ExportTemplateDSLResponse>(`/rag/pipeline/customized/templates/${templateId}`)
}

export const importPipelineDSL = (request: ImportPipelineDSLRequest) => {
  return post<ImportPipelineDSLResponse>('/rag/pipelines/imports', { body: request })
}

export const confirmImportPipelineDSL = (importId: string) => {
  return post<ImportPipelineDSLConfirmResponse>(`/rag/pipelines/imports/${importId}/confirm`)
}

export const checkPipelineDependencies = (pipelineId: string) => {
  return get<PipelineCheckDependenciesResponse>(`/rag/pipelines/imports/${pipelineId}/check-dependencies`)
}

export const fetchDraftPipelineProcessingParams = (params: PipelineProcessingParamsRequest) => {
  const { pipeline_id, node_id } = params
  return get<PipelineProcessingParamsResponse>(`/rag/pipelines/${pipeline_id}/workflows/draft/processing/parameters`, {
    params: {
      node_id,
    },
  })
}

export const fetchPublishedPipelineProcessingParams = (params: PipelineProcessingParamsRequest) => {
  const { pipeline_id, node_id } = params
  return get<PipelineProcessingParamsResponse>(`/rag/pipelines/${pipeline_id}/workflows/published/processing/parameters`, {
    params: {
      node_id,
    },
  })
}

export const fetchPipelineDataSourceList = () => {
  return get<DataSourceItem[]>('/rag/pipelines/datasource-plugins')
}

export const fetchPublishedPipelineInfo = (pipelineId: string) => {
  return get<PublishedPipelineInfoResponse>(`/rag/pipelines/${pipelineId}/workflows/publish`)
}

export const runPublishedPipeline = (request: PublishedPipelineRunRequest) => {
  const { pipeline_id: pipelineId, is_preview, ...rest } = request
  return post<PublishedPipelineRunPreviewResponse | PublishedPipelineRunResponse>(`/rag/pipelines/${pipelineId}/workflows/published/run`, {
    body: {
      ...rest,
      is_preview,
      response_mode: 'blocking',
    },
  })
}

export const fetchDataSourceCredentials = (provider: string, pluginId: string) => {
  return get<{ result: ToolCredential[] }>(`/auth/plugin/datasource?provider=${provider}&plugin_id=${pluginId}`)
}

export const updateDataSourceCredentials = (payload: { provider: string, pluginId: string, credentials: Record<string, any>, name: string }) => {
  const { provider, pluginId, credentials, name } = payload
  return post('/auth/plugin/datasource', {
    body: {
      provider,
      plugin_id: pluginId,
      credentials,
      name,
    },
  })
}

export const fetchDraftPipelinePreProcessingParams = (params: PipelinePreProcessingParamsRequest) => {
  const { pipeline_id, node_id } = params
  return get<PipelinePreProcessingParamsResponse>(`/rag/pipelines/${pipeline_id}/workflows/draft/pre-processing/parameters`, {
    params: {
      node_id,
    },
  })
}

export const fetchPublishedPipelinePreProcessingParams = (params: PipelinePreProcessingParamsRequest) => {
  const { pipeline_id, node_id } = params
  return get<PipelinePreProcessingParamsResponse>(`/rag/pipelines/${pipeline_id}/workflows/published/pre-processing/parameters`, {
    params: {
      node_id,
    },
  })
}

export const exportPipelineDSL = (pipelineId: string, include = false) => {
  return get<ExportTemplateDSLResponse>(`/rag/pipelines/${pipelineId}/exports?include_secret=${include}`)
}

export const publishAsCustomizedPipeline = (payload: { pipelineId: string, name: string, icon_info: IconInfo, description?: string }) => {
  const { pipelineId, ...rest } = payload
  return post(`/rag/pipelines/${pipelineId}/customized/publish`, {
    body: {
      ...rest,
    },
  })
}

export const fetchPipelineExecutionLog = (params: PipelineExecutionLogRequest) => {
  const { dataset_id, document_id } = params
  return get<PipelineExecutionLogResponse>(`/datasets/${dataset_id}/documents/${document_id}/pipeline-execution-log`)
}

export const previewOnlineDocument = (params: OnlineDocumentPreviewRequest) => {
  const { pipelineId, datasourceNodeId, workspaceID, pageID, pageType, credentialId } = params
  return post<OnlineDocumentPreviewResponse>(
    `/rag/pipelines/${pipelineId}/workflows/published/datasource/nodes/${datasourceNodeId}/preview`,
    {
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
  )
}

export const convertDatasetToPipeline = (datasetId: string) => {
  return post<ConversionResponse>(`/rag/pipelines/transform/datasets/${datasetId}`)
}

export const runDatasourceNodeSingle = (params: DatasourceNodeSingleRunRequest) => {
  const { pipeline_id: pipelineId, ...rest } = params
  return post<DatasourceNodeSingleRunResponse>(`/rag/pipelines/${pipelineId}/workflows/draft/datasource/variables-inspect`, {
    body: rest,
  })
}

export const createEmptyDatasetForPipeline = () => {
  return post<CreateDatasetResponse>('/rag/pipeline/empty-dataset')
}

export const createDatasetForPipeline = (request: CreateDatasetReq) => {
  return post<CreateDatasetResponse>('/rag/pipeline/dataset', { body: request })
}
