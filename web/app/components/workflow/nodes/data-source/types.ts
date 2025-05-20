import type { CommonNodeType } from '@/app/components/workflow/types'
import type { RAGPipelineVariables } from '@/models/pipeline'

export type DataSourceNodeType = CommonNodeType & {
  variables: RAGPipelineVariables
}
