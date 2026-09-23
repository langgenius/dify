export const FlowType = {
  appFlow: 'appFlow',
  ragPipeline: 'ragPipeline',
  snippet: 'snippet',
} as const

export type FlowType = (typeof FlowType)[keyof typeof FlowType]
