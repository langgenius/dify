import { FlowType } from '@/types/common'

export const flowPrefixMap = {
  [FlowType.appFlow]: 'apps',
  [FlowType.ragFlow]: 'rag/pipelines',
}

export const getFlowPrefix = (type: FlowType) => {
  return flowPrefixMap[type] || flowPrefixMap[FlowType.appFlow]
}
