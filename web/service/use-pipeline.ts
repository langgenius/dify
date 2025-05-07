import { useMutation, useQuery } from '@tanstack/react-query'
import { del, get, patch } from './base'
import type {
  ExportPipelineDSLResponse,
  PipelineTemplateByIdResponse,
  PipelineTemplateListParams,
  PipelineTemplateListResponse,
  UpdatePipelineInfoPayload,
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

export const usePipelineTemplateById = (templateId: string) => {
  return useQuery<PipelineTemplateByIdResponse>({
    queryKey: [NAME_SPACE, 'template', templateId],
    queryFn: () => {
      return get<PipelineTemplateByIdResponse>(`/rag/pipeline/template/${templateId}`)
    },
  })
}

export const useUpdatePipelineInfo = ({
  onSuccess,
  onError,
}: {
  onSuccess?: () => void
  onError?: (error: any) => void
}) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'template', 'update'],
    mutationFn: (payload: UpdatePipelineInfoPayload) => {
      const { pipelineId, ...rest } = payload
      return patch(`/rag/pipeline/${pipelineId}`, {
        body: rest,
      })
    },
    onSuccess,
    onError,
  })
}

export const useDeletePipeline = ({
  onSuccess,
  onError,
}: {
  onSuccess?: () => void
  onError?: (error: any) => void
}) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'template', 'delete'],
    mutationFn: (pipelineId: string) => {
      return del(`/rag/pipeline/${pipelineId}`)
    },
    onSuccess,
    onError,
  })
}

export const useExportPipelineDSL = (pipelineId: string) => {
  return useQuery<ExportPipelineDSLResponse>({
    queryKey: [NAME_SPACE, 'template', 'export', pipelineId],
    queryFn: () => {
      return get<ExportPipelineDSLResponse>(`/rag/pipeline/${pipelineId}`)
    },
  })
}
