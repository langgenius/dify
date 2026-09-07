export const TabType = {
  settings: 'settings',
  lastRun: 'lastRun',
  relations: 'relations',
} as const

export type TabType = (typeof TabType)[keyof typeof TabType]
