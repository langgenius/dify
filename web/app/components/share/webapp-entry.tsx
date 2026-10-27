'use client'

import type {
  LoginStatusResponse,
  WebAppParametersResponse,
} from '@dify/contracts/api/web/types.gen'
import { createContext, use } from 'react'

type EntryParameters = Pick<
  WebAppParametersResponse,
  | 'account_login_enabled'
  | 'account_login_url'
  | 'allow_anonymous_end_user_auth'
  | 'connection_revision'
  | 'requires_end_user_connections'
  | 'connection_requirements'
>

export type WebAppEntryState =
  | {
      status: 'loading' | 'unavailable'
      canRun: false
      showSignIn: false
    }
  | {
      status: 'ready' | 'connections-pending'
      account: 'loading' | 'unavailable' | 'anonymous' | 'authenticated'
      parameters: EntryParameters
      canRun: boolean
      showSignIn: boolean
    }

/** A passport grants App access; only end_user login status identifies an account. */
export function getWebAppEntryState({
  parameters,
  loginStatus,
  loginStatusError = false,
  canAccess,
  appDataReady,
  hasError,
}: {
  parameters?: EntryParameters | null
  loginStatus?: LoginStatusResponse
  loginStatusError?: boolean
  canAccess?: boolean
  appDataReady: boolean
  hasError: boolean
}): WebAppEntryState {
  if (hasError || canAccess === false)
    return { status: 'unavailable', canRun: false, showSignIn: false }

  if (!appDataReady || !parameters || canAccess === undefined)
    return { status: 'loading', canRun: false, showSignIn: false }

  // Selecting a connection alone cannot make it runnable; a successful preflight is required.
  const requiresConnections = parameters.requires_end_user_connections
  const account = loginStatusError
    ? 'unavailable'
    : !loginStatus
      ? 'loading'
      : loginStatus.logged_in
        ? 'authenticated'
        : 'anonymous'
  return {
    status: requiresConnections ? 'connections-pending' : 'ready',
    account,
    parameters,
    canRun: !requiresConnections,
    showSignIn: parameters.account_login_enabled && account === 'anonymous',
  }
}

export const WebAppEntryContext = createContext<WebAppEntryState | null>(null)

export function useWebAppEntry() {
  return use(WebAppEntryContext)
}
