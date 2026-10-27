import type { WebAppAddress } from '../webapp-address'
import { getHttpErrorStatus } from '../http-error'
import {
  captureWebAppAuthSession,
  expireWebAppAccountSession,
  getWebAppAuthSessionSnapshot,
  setWebAppPassport,
} from '../webapp-auth'
import { webAppClient } from './index'

/** Restore an App user session independently of enterprise SSO and anonymous access. */
export async function restoreWebAppAccountSession(
  address: Extract<WebAppAddress, { kind: 'default' }>,
  isActive: () => boolean,
) {
  const isSameSession = captureWebAppAuthSession()
  const canContinue = () => isActive() && isSameSession()
  const context = { address, authSession: getWebAppAuthSessionSnapshot(), silent: true }

  try {
    const status = await webAppClient.login.status.get(
      { query: { mode: 'end_user', app_code: address.code } },
      { context },
    )
    if (!canContinue()) return false
    if (!status.logged_in) {
      expireWebAppAccountSession()
      return false
    }
    if (!status.app_logged_in) {
      const { access_token } = await webAppClient.passport.get(
        { query: { mode: 'end_user' } },
        { context },
      )
      if (!canContinue()) return false
      setWebAppPassport(address, access_token, 'authenticated')
    }
    return true
  } catch (error) {
    if (!canContinue()) return false
    if (getHttpErrorStatus(error) === 401) {
      expireWebAppAccountSession()
      return false
    }
    throw error
  }
}
