import { get, post } from './base'

export const fetchAnnotationList = (appId: string, params: Record<string, any>) => {
  return get(`apps/${appId}/annotations`, { params })
}

export const addAnnotation = (appId: string, body: Record<string, any>) => {
  return post(`apps/${appId}/annotations`, { body })
}
