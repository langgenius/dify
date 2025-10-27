import type { Fetcher } from 'swr'
import { del, get, patch, post } from './base'

export type FilterEntity = {
  name: string
  attribute_type?: string // 为空表示基础实体，否则为属性（尺寸、颜色等）
}

export type FilterRulesResponse = {
  entities: FilterEntity[] // 基础实体列表
  attributes: FilterEntity[] // 属性列表
}

export type UpdateFilterRulesRequest = {
  entities: FilterEntity[]
  attributes: FilterEntity[]
}

export type CreateEntityRequest = {
  name: string
  attribute_type?: string
}

export type UpdateEntityRequest = {
  old_name: string
  new_name: string
  attribute_type?: string
}

export type DeleteEntityRequest = {
  name: string
}

/**
 * 获取所有过滤规则
 */
export const fetchFilterRules: Fetcher<FilterRulesResponse> = () => {
  return get<FilterRulesResponse>('/workspaces/current/filter-rules')
}

/**
 * 批量更新过滤规则
 */
export const updateFilterRules: Fetcher<FilterRulesResponse, UpdateFilterRulesRequest> = (data) => {
  return post<FilterRulesResponse>('/workspaces/current/filter-rules', { body: data })
}

/**
 * 添加新实体或属性
 */
export const addFilterEntity: Fetcher<{ message: string; entity: FilterEntity }, CreateEntityRequest> = (data) => {
  return post<{ message: string; entity: FilterEntity }>('/workspaces/current/filter-rules/entity', {
    body: data,
  })
}

/**
 * 更新实体或属性
 */
export const updateFilterEntity: Fetcher<{ message: string }, UpdateEntityRequest> = (data) => {
  return patch<{ message: string }>('/workspaces/current/filter-rules/entity', { body: data })
}

/**
 * 删除实体或属性
 */
export const deleteFilterEntity: Fetcher<{ message: string }, DeleteEntityRequest> = (data) => {
  return del<{ message: string }>('/workspaces/current/filter-rules/entity', { body: data })
}
