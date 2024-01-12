import { get, post } from './base'
import type { CustomCollectionBackend } from '@/app/components/tools/types'

export const fetchCollectionList = () => {
  return get('/workspaces/current/tool-providers')
}

export const fetchBuiltInToolList = (collectionName: string) => {
  return get(`/workspaces/current/tool-provider/builtin/${collectionName}/tools`)
}

export const fetchBuiltInToolCredentialSchema = (collectionName: string) => {
  return get(`/workspaces/current/tool-provider/builtin/${collectionName}/credentials_schema`)
}

export const updateBuiltInToolCredential = (collectionName: string, credential: Record<string, any>) => {
  return post(`/workspaces/current/tool-provider/builtin/${collectionName}/update`, {
    body: {
      credentials: credential,
    },
  })
}

export const removeBuiltInToolCredential = (collectionName: string) => {
  return post(`/workspaces/current/tool-provider/builtin/${collectionName}/delete`, {
    body: {},
  })
}

export const parseParamsSchema = (schema: string) => {
  return post('/workspaces/current/tool-provider/api/schema', {
    body: {
      schema,
    },
  })
}

export const createCustomCollection = (collection: CustomCollectionBackend) => {
  return post('/workspaces/current/tool-provider/api/add', {
    body: collection,
  })
}
