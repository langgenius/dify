import { get, post } from './base'

export const fetchAppList = () => {
  return get('/explore/apps')
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
