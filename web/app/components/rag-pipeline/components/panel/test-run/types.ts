import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'

export const TestRunStep = {
  dataSource: 'dataSource',
  documentProcessing: 'documentProcessing',
} as const
export type TestRunStep = typeof TestRunStep[keyof typeof TestRunStep]

export type DataSourceOption = {
  label: string
  value: string
  data: DataSourceNodeType
}

export type Datasource = {
  nodeId: string
  nodeData: DataSourceNodeType
}
