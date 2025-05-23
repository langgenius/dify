import type { CommonNodeType } from '@/app/components/workflow/types'
import type { RAGPipelineVariables } from '@/models/pipeline'
import type { CollectionType } from '@/app/components/tools/types'

export type DataSourceNodeType = CommonNodeType & {
  variables: RAGPipelineVariables
  output_schema: Record<string, any>
  provider_id: string
  provider_type: CollectionType
  fileExtensions?: string[]
}
