export const FlowType = {
  appFlow: 'appFlow',
  ragPipeline: 'ragPipeline',
} as const

// eslint-disable-next-line ts/no-redeclare -- value-type pair
export type FlowType = typeof FlowType[keyof typeof FlowType]
