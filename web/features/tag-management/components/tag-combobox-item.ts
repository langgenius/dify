import type { Tag, TagType } from '@/contract/console/tags'

export type CreateTagOption = {
  id: string
  name: string
  type: TagType
  binding_count: number
  isCreateOption: true
}

export type TagComboboxItem = Tag | CreateTagOption

export const isCreateTagOption = (tag: TagComboboxItem): tag is CreateTagOption => {
  return 'isCreateOption' in tag
}
