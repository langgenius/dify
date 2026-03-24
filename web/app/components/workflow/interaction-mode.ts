export const InteractionMode = {
  Default: 'default',
  Subgraph: 'subgraph',
} as const

export type InteractionModeType = typeof InteractionMode[keyof typeof InteractionMode]
