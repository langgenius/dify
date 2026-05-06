import { type } from '@orpc/contract'
import { base } from '../base'

export type TagType = 'knowledge' | 'app'

export type Tag = {
  id: string
  name: string
  type: TagType
  binding_count: number
}

export const tagListContract = base
  .route({
    path: '/tags',
    method: 'GET',
  })
  .input(type<{
    query: {
      type: TagType
    }
  }>())
  .output(type<Tag[]>())

export const tagCreateContract = base
  .route({
    path: '/tags',
    method: 'POST',
  })
  .input(type<{
    body: {
      name: string
      type: TagType
    }
  }>())
  .output(type<Tag>())

export const tagUpdateContract = base
  .route({
    path: '/tags/{tagId}',
    method: 'PATCH',
  })
  .input(type<{
    params: {
      tagId: string
    }
    body: {
      name: string
    }
  }>())
  .output(type<unknown>())

export const tagDeleteContract = base
  .route({
    path: '/tags/{tagId}',
    method: 'DELETE',
  })
  .input(type<{
    params: {
      tagId: string
    }
  }>())
  .output(type<unknown>())

export const tagBindingCreateContract = base
  .route({
    path: '/tag-bindings',
    method: 'POST',
  })
  .input(type<{
    body: {
      tag_ids: string[]
      target_id: string
      type: TagType
    }
  }>())
  .output(type<unknown>())

export const tagBindingRemoveContract = base
  .route({
    path: '/tag-bindings/remove',
    method: 'POST',
  })
  .input(type<{
    body: {
      tag_ids: string[]
      target_id: string
      type: TagType
    }
  }>())
  .output(type<unknown>())
