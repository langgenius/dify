import { get, post, del } from './base'

export const fetchAppList = () => {
  return get('/explore/apps')
}

export const fetchAppDetail = (id: string) : Promise<any> => {
  return get(`/explore/apps/${id}`)
}

export const fetchInstalledAppList = () => {
  return get('/installed-apps')
}

export const installApp = (id: string) => {
  return post('/installed-apps', {
    body: {
      app_id: id
    }
  })
}

export const uninstallApp = (id: string) => {
  return del(`/installed-apps/${id}`)
}
