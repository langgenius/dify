import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import type { DatasourceType } from '@/models/pipeline'

export enum TestRunStep {
  dataSource = 'dataSource',
  documentProcessing = 'documentProcessing',
}

export type DataSourceOption = {
  label: string
  value: string
  data: DataSourceNodeType
}

export type Datasource = {
  nodeId: string
  type: DatasourceType
  description: string
  docTitle?: string
  docLink?: string
  fileExtensions?: string[]
}
