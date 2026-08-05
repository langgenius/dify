import type { TagResponse as Tag, TagType } from '@dify/contracts/api/console/tags/types.gen'

type CreateTagOption = {
  id: string
  name: string
  type: TagType
  binding_count: string
  isCreateOption: true
}

export type TagComboboxItem = Tag | CreateTagOption

export const isCreateTagOption = (tag: TagComboboxItem): tag is CreateTagOption => {
  return 'isCreateOption' in tag
}
