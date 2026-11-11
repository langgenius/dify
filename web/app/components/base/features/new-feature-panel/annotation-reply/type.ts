export const PageType = {
  log: 'log',
  annotation: 'annotation',
} as const

export type PageType = (typeof PageType)[keyof typeof PageType]
