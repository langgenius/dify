import { get } from './base'

export const fetchCollectionList = () => {
  return get('/workspaces/current/tool-providers')
}

export const fetchBuiltInToolList = (collectionName: string) => {
  return get(`/workspaces/current/tool-provider/builtin/${collectionName}/tools`)
}
