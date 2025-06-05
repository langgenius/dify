import { CONVERSATION_ID_INFO } from '../base/chat/constants'
import { fetchAccessToken } from '@/service/share'

export const checkOrSetAccessToken = async (appCode?: string) => {
  const sharedToken = appCode || globalThis.location.pathname.split('/').slice(-1)[0]
  const accessToken = localStorage.getItem('token') || JSON.stringify({ [sharedToken]: '' })
  let accessTokenJson = { [sharedToken]: '' }
  try {
    accessTokenJson = JSON.parse(accessToken)
  }
  catch (e) {

  }

  if (!accessTokenJson[sharedToken]) {
    const webAppAccessToken = localStorage.getItem('webapp_access_token')
    const res = await fetchAccessToken({ appCode: sharedToken, webAppAccessToken })
    accessTokenJson[sharedToken] = res.access_token
    localStorage.setItem('token', JSON.stringify(accessTokenJson))
  }
}

export const setAccessToken = async (sharedToken: string, token: string) => {
  const accessToken = localStorage.getItem('token') || JSON.stringify({ [sharedToken]: '' })
  let accessTokenJson = { [sharedToken]: '' }
  try {
    accessTokenJson = JSON.parse(accessToken)
  }
  catch (e) {

  }

  localStorage.removeItem(CONVERSATION_ID_INFO)

  accessTokenJson[sharedToken] = token
  localStorage.setItem('token', JSON.stringify(accessTokenJson))
}

export const removeAccessToken = () => {
  const sharedToken = globalThis.location.pathname.split('/').slice(-1)[0]

  const accessToken = localStorage.getItem('token') || JSON.stringify({ [sharedToken]: '' })
  let accessTokenJson = { [sharedToken]: '' }
  try {
    accessTokenJson = JSON.parse(accessToken)
  }
  catch (e) {

  }

  localStorage.removeItem(CONVERSATION_ID_INFO)
  localStorage.removeItem('webapp_access_token')

  delete accessTokenJson[sharedToken]
  localStorage.setItem('token', JSON.stringify(accessTokenJson))
}
