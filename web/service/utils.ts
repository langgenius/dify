import { FlowType } from '@/types/common'

const flowPrefixMap = {
  [FlowType.appFlow]: 'apps',
  [FlowType.ragPipeline]: 'rag/pipelines',
  [FlowType.snippet]: 'snippets',
}

export const getFlowPrefix = (type?: FlowType) => {
  return flowPrefixMap[type!] || flowPrefixMap[FlowType.appFlow]
}

type FlowTypeCalls<TApp, TPipeline, TSnippet> = {
  app: () => TApp
  ragPipeline: () => TPipeline
  snippet: () => TSnippet
}

// Draft workflow endpoints exist per flow type with their own path params, so each branch keeps
// its own fully typed console client call.
export const callByFlowType = <TApp, TPipeline, TSnippet>(
  type: FlowType | undefined,
  calls: FlowTypeCalls<TApp, TPipeline, TSnippet>,
): TApp | TPipeline | TSnippet => {
  if (type === FlowType.ragPipeline) return calls.ragPipeline()
  if (type === FlowType.snippet) return calls.snippet()
  return calls.app()
}
