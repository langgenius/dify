import { DataType } from '../types'

const metadataTypeIconClassMap: Record<DataType, string> = {
  [DataType.string]: 'i-ri-text-snippet',
  [DataType.number]: 'i-ri-hashtag',
  [DataType.time]: 'i-ri-time-line',
}

export function getIconClassName(type: DataType) {
  return metadataTypeIconClassMap[type] ?? metadataTypeIconClassMap[DataType.string]
}
