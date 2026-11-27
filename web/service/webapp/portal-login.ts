import { basePath } from '@/utils/var'
import { WEBAPP_PORTAL_LOGIN_CODE, withWebAppPortalLoginCode } from '../webapp-address'
import { captureWebAppAuthSession, startWebAppAccountSession, webAppLogout } from '../webapp-auth'
import { webAppClient } from './index'
import {
  createWebAppLoginProof,
  readWebAppLoginTransaction,
  removeWebAppLoginTransaction,
  storeWebAppLoginTransaction,
} from './login-transaction'

const PORTAL_LOGIN_STORAGE_KEY = 'webapp-portal-login'

let pendingLogin:
  | { id: symbol; location: string; signingOut: boolean; promise: Promise<void> }
  | undefined
let pendingExchange: { location: string; promise: Promise<string> } | undefined

function openPortalSignIn(returnPath: string, signingOut: boolean) {
  const location = window.location.href
  if (pendingLogin?.location === location && (!signingOut || pendingLogin.signingOut))
    return pendingLogin.promise
  const id = Symbol('portal sign-in navigation')
  const isCurrentSession = captureWebAppAuthSession()
  const assertCurrentNavigation = () => {
    if (pendingLogin?.id !== id || window.location.href !== location)
      throw new DOMException('The Web App login changed.', 'AbortError')
  }
  const promise = (async () => {
    const [features, proof] = await Promise.all([
      webAppClient.systemFeatures.get(undefined),
      createWebAppLoginProof(),
    ])
    assertCurrentNavigation()
    if (!isCurrentSession()) throw new DOMException('The Web App login changed.', 'AbortError')

    const signin = new URL(`${features.console_web_url.replace(/\/$/, '')}/signin`, location)
    if (!['http:', 'https:'].includes(signin.protocol) || signin.username || signin.password)
      throw new Error('Invalid Account sign-in URL.')

    const redirectUrl = new URL(`${basePath.replace(/\/$/, '')}${returnPath}`, location)
    signin.searchParams.set('is_end_user', '1')
    signin.searchParams.set('redirect_url', returnPath)
    signin.searchParams.set('code_challenge', proof.challenge)
    signin.searchParams.set('code_challenge_method', 'S256')
    if (signingOut) {
      // End the Console session on its own origin before it can reissue the Web App session.
      signin.searchParams.set('switch_account', '1')
      await webAppLogout(null)
      assertCurrentNavigation()
    }
    storeWebAppLoginTransaction(PORTAL_LOGIN_STORAGE_KEY, proof.verifier, redirectUrl.href)
    window.location.replace(signin.href)
  })()
  pendingLogin = { id, location, signingOut, promise }
  const clearPendingLogin = () => {
    if (pendingLogin?.id === id) pendingLogin = undefined
  }
  void promise.then(clearPendingLogin, clearPendingLogin)
  return promise
}

export function redirectToWebAppPortalSignIn(returnPath: string) {
  return openPortalSignIn(returnPath, false)
}

export function logoutFromWebAppPortal() {
  return openPortalSignIn('/my-apps', true)
}

export function completeWebAppPortalLogin() {
  const location = window.location.href
  if (pendingExchange?.location === location) return pendingExchange.promise
  const isCurrentSession = captureWebAppAuthSession()
  const promise = (async () => {
    const callback = new URL(location)
    const loginCode = callback.searchParams.get(WEBAPP_PORTAL_LOGIN_CODE)
    const transaction = readWebAppLoginTransaction(PORTAL_LOGIN_STORAGE_KEY)
    if (
      !loginCode ||
      !transaction ||
      withWebAppPortalLoginCode(new URL(transaction.redirectUrl), loginCode).href !== location
    )
      throw new Error('Missing or expired Web App portal login transaction.')

    removeWebAppLoginTransaction(PORTAL_LOGIN_STORAGE_KEY)
    await webAppClient.account.session.post({
      body: { login_code: loginCode, code_verifier: transaction.verifier },
    })
    if (!isCurrentSession() || window.location.href !== location)
      throw new DOMException('The Web App login changed.', 'AbortError')
    // Check the Cookie before mounting queries that could start another sign-in.
    await webAppClient.account.profile.get(undefined)
    if (!isCurrentSession() || window.location.href !== location)
      throw new DOMException('The Web App login changed.', 'AbortError')
    startWebAppAccountSession()
    return transaction.redirectUrl
  })()
  pendingExchange = { location, promise }
  return promise
}
