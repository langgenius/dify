import { CONVERSATION_ID_INFO } from '../base/chat/constants'
import { fetchAccessToken } from '@/service/share'
import { getProcessedSystemVariablesFromUrlParams } from '../base/chat/utils'

export const isTokenV1 = (token: Record<string, any>) => {
  return !token.version
}

export const getInitialTokenV2 = (): Record<string, any> => ({
  version: 2,
})

export const checkOrSetAccessToken = async () => {
  const sharedToken = globalThis.location.pathname.split('/').slice(-1)[0]
  const userId = (await getProcessedSystemVariablesFromUrlParams()).user_id
  const accessToken = localStorage.getItem('token') || JSON.stringify(getInitialTokenV2())
  let accessTokenJson = getInitialTokenV2()
  try {
    accessTokenJson = JSON.parse(accessToken)
    if (isTokenV1(accessTokenJson))
      accessTokenJson = getInitialTokenV2()
  }
  catch {

  }
  if (!accessTokenJson[sharedToken]?.[userId || 'DEFAULT']) {
    const res = await fetchAccessToken(sharedToken, userId)
    accessTokenJson[sharedToken] = {
      ...accessTokenJson[sharedToken],
      [userId || 'DEFAULT']: res.access_token,
    }
    localStorage.setItem('token', JSON.stringify(accessTokenJson))
  }
}

export const setAccessToken = async (sharedToken: string, token: string, user_id?: string) => {
  const accessToken = localStorage.getItem('token') || JSON.stringify(getInitialTokenV2())
  let accessTokenJson = getInitialTokenV2()
  try {
    accessTokenJson = JSON.parse(accessToken)
    if (isTokenV1(accessTokenJson))
      accessTokenJson = getInitialTokenV2()
  }
  catch {

  }

  localStorage.removeItem(CONVERSATION_ID_INFO)

  accessTokenJson[sharedToken] = {
    ...accessTokenJson[sharedToken],
    [user_id || 'DEFAULT']: token,
  }
  localStorage.setItem('token', JSON.stringify(accessTokenJson))
}

export const removeAccessToken = () => {
  const sharedToken = globalThis.location.pathname.split('/').slice(-1)[0]

  const accessToken = localStorage.getItem('token') || JSON.stringify(getInitialTokenV2())
  let accessTokenJson = getInitialTokenV2()
  try {
    accessTokenJson = JSON.parse(accessToken)
    if (isTokenV1(accessTokenJson))
      accessTokenJson = getInitialTokenV2()
  }
  catch {

  }

  localStorage.removeItem(CONVERSATION_ID_INFO)

  delete accessTokenJson[sharedToken]
  localStorage.setItem('token', JSON.stringify(accessTokenJson))
}
