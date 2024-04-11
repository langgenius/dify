import { del, get, patch, post } from './base'
import type { Tag } from '@/app/components/base/tag-management/constant'

export const fetchTagList = () => {
  return get<Tag[]>('/tags')
}

export const createTag = (name: string, type: string) => {
  return post('/tags', {
    body: {
      name,
      type,
    },
  })
}

export const updateTag = (tagID: string, name: string) => {
  return patch(`/tags/${tagID}`, {
    body: {
      name,
    },
  })
}

export const deleteTag = (tagID: string) => {
  return del(`/tags/${tagID}`)
}

export const bindTag = (tagIDList: string[], targetID: string, type: string) => {
  return post('/tag-bindings/create', {
    body: {
      tag_ids: tagIDList,
      target_id: targetID,
      type,
    },
  })
}

export const unBindTag = (tagIDList: string[], targetID: string, type: string) => {
  return post('/tag-bindings/remove', {
    body: {
      tag_ids: tagIDList,
      target_id: targetID,
      type,
    },
  })
}
