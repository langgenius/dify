export const segmentImportStatus = {
  waiting: 'waiting',
  processing: 'processing',
  completed: 'completed',
  error: 'error',
} as const

export type SegmentImportStatus = (typeof segmentImportStatus)[keyof typeof segmentImportStatus]

export const isSegmentImportStatus = (value: string): value is SegmentImportStatus =>
  Object.values<string>(segmentImportStatus).includes(value)
