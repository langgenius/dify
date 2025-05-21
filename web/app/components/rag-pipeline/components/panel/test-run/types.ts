import type { DataSourceProvider } from '@/models/common'
import type { DataSourceType } from '@/models/datasets'
import type { RAGPipelineVariables } from '@/models/pipeline'

export enum TestRunStep {
  dataSource = 'dataSource',
  documentProcessing = 'documentProcessing',
}

export type DataSourceOption = {
  label: string
  value: string
  type: DataSourceType | DataSourceProvider
}

export type Datasource = {
  nodeId: string
  type: DataSourceType | DataSourceProvider
  variables: RAGPipelineVariables
}
