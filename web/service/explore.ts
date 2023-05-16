import { get } from './base'

export const fetchAppList = () => {
  return get('/explore/apps')
}