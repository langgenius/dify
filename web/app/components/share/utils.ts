import { fetchAccessToken } from '@/service/share'
export const checkOrSetAccessToken = async () => {
  const sharedToken = globalThis.location.pathname.split('/').slice(-1)[0]
  const accessToken = localStorage.getItem('token') || JSON.stringify({ [sharedToken]: '' })
  let accessTokenJson = { [sharedToken]: '' }
  try {
    accessTokenJson = JSON.parse(accessToken)
  }
  catch (e) {

  }
  if (!accessTokenJson[sharedToken]) {
    const res = await fetchAccessToken(sharedToken)
    accessTokenJson[sharedToken] = res.access_token
    localStorage.setItem('token', JSON.stringify(accessTokenJson))
  }
}
