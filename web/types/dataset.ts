export const segmentImportStatus = {
  waiting: 'waiting',
  processing: 'processing',
  completed: 'completed',
  error: 'error',
} as const

export type SegmentImportStatus = typeof segmentImportStatus[keyof typeof segmentImportStatus]
