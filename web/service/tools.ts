import { get, post } from './base'

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
    body: credential,
  })
}
