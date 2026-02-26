import type { Tag } from '@/app/components/base/tag-management/constant'
import { del, get, patch, post } from './base'

export const fetchTagList = (type: string) => {
  return get<Tag[]>('/tags', { params: { type } })
}

export const createTag = (name: string, type: string) => {
  return post<Tag>('/tags', {
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

export const unBindTag = (tagID: string, targetID: string, type: string) => {
  return post('/tag-bindings/remove', {
    body: {
      tag_id: tagID,
      target_id: targetID,
      type,
    },
  })
}
