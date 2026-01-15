import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'

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
  nodeData: DataSourceNodeType
}
