import type { InputVar } from '@/models/pipeline'

export type SortableItem = {
  id: string
  chosen: boolean
  selected: boolean
} & InputVar
