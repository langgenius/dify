import { del, get, post, put } from './base'
import type { PromptTemplate, PromptTemplateRequest } from '@/models/prompt-template'

export const fetchPromptTemplates = async () => {
  return get<{ data: PromptTemplate[] }>('/prompt-templates')
}

export const createPromptTemplate = async (data: PromptTemplateRequest) => {
  return post('/prompt-templates', { body: data })
}

export const deletePromptTemplate = async (id: string) => {
  return del(`/prompt-templates/${id}`)
}

export const getPromptTemplate = async (id: string) => {
  return get<PromptTemplate>(`/prompt-templates/${id}`)
}

export const updatePromptTemplate = async (id: string, data: Partial<PromptTemplate>) => {
  return put(`/prompt-templates/${id}`, { body: data })
}
