import type { DatasourceType, RAGPipelineVariables } from '@/models/pipeline'

export enum TestRunStep {
  dataSource = 'dataSource',
  documentProcessing = 'documentProcessing',
}

export type DataSourceOption = {
  label: string
  value: string
  type: DatasourceType
}

export type Datasource = {
  nodeId: string
  type: DatasourceType
  variables: RAGPipelineVariables
  description: string
  docTitle?: string
  docLink?: string
}
