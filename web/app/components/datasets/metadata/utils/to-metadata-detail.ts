import type { MetadataDetail } from '@dify/contracts/api/console/datasets/types.gen'
import type { MetadataItemWithValue } from '../types'

export const toMetadataDetail = (item: MetadataItemWithValue): MetadataDetail => ({
  id: item.id,
  name: item.name,
  // Legacy document reads can contain booleans; metadata writes coerce them to numbers.
  value: typeof item.value === 'boolean' ? Number(item.value) : (item.value ?? null),
})
