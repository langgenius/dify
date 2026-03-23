export const FlowType = {
  appFlow: 'appFlow',
  ragPipeline: 'ragPipeline',
} as const

export type FlowType = typeof FlowType[keyof typeof FlowType]
