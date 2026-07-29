'use client'
import { useEffect, useState } from 'react'
import { validateRedirectUrl } from '@/utils/urlValidation'

export const OAUTH_CALLBACK_MESSAGE_TYPE = 'oauth_callback'
export const OAUTH_CALLBACK_CHANNEL_NAME = 'dify-oauth-callback'

export type OAuthCallbackData = {
  type: typeof OAUTH_CALLBACK_MESSAGE_TYPE
  success?: boolean
  subscriptionId?: string | null
  error?: string | null
  errorDescription?: string | null
}

export type OAuthCallbackStatus = 'success' | 'error'

type ParsedOAuthCallbackParams = {
  success: boolean
  subscriptionId: string | null
  error: string | null
  errorDescription: string | null
}

export const parseOAuthCallbackParams = (search: string): ParsedOAuthCallbackParams => {
  const urlParams = new URLSearchParams(search)
  const subscriptionId = urlParams.get('subscription_id')
  const error = urlParams.get('error')
  const errorDescription = urlParams.get('error_description')

  if (subscriptionId) {
    return {
      success: true,
      subscriptionId,
      error: null,
      errorDescription: null,
    }
  }

  if (error) {
    return {
      success: false,
      subscriptionId: null,
      error,
      errorDescription,
    }
  }

  return {
    success: true,
    subscriptionId: null,
    error: null,
    errorDescription: null,
  }
}

export const buildOAuthCallbackMessage = (search: string): OAuthCallbackData => {
  const parsed = parseOAuthCallbackParams(search)

  if (parsed.subscriptionId) {
    return {
      type: OAUTH_CALLBACK_MESSAGE_TYPE,
      success: true,
      subscriptionId: parsed.subscriptionId,
    }
  }

  if (parsed.error) {
    return {
      type: OAUTH_CALLBACK_MESSAGE_TYPE,
      success: false,
      error: parsed.error,
      errorDescription: parsed.errorDescription,
    }
  }

  return {
    type: OAUTH_CALLBACK_MESSAGE_TYPE,
  }
}

export const notifyOAuthOpener = (message: OAuthCallbackData): boolean => {
  if (!window.opener) return false

  try {
    const targetOrigin = window.opener.origin || '*'
    window.opener.postMessage(message, targetOrigin)
    return true
  } catch {
    return false
  }
}

export const notifyOAuthBroadcast = (message: OAuthCallbackData): void => {
  if (typeof BroadcastChannel === 'undefined') return

  const channel = new BroadcastChannel(OAUTH_CALLBACK_CHANNEL_NAME)
  channel.postMessage(message)
  channel.close()
}

export const notifyOAuthCallback = (message: OAuthCallbackData): void => {
  notifyOAuthOpener(message)
  notifyOAuthBroadcast(message)
}

export const useOAuthCallback = () => {
  const [{ status, errorDescription }] = useState(() => {
    const parsed = parseOAuthCallbackParams(window.location.search)

    return {
      status: (parsed.success ? 'success' : 'error') as OAuthCallbackStatus,
      errorDescription: parsed.errorDescription,
    }
  })

  useEffect(() => {
    notifyOAuthCallback(buildOAuthCallbackMessage(window.location.search))
    window.close()
  }, [])

  return { status, errorDescription }
}

export const openOAuthPopup = (url: string, callback: (data?: OAuthCallbackData) => void) => {
  const width = 600
  const height = 600
  const left = window.screenX + (window.outerWidth - width) / 2
  const top = window.screenY + (window.outerHeight - height) / 2

  validateRedirectUrl(url)
  const popup = window.open(
    url,
    'OAuth',
    `width=${width},height=${height},left=${left},top=${top},scrollbars=yes`,
  )

  let completed = false
  let checkClosed: ReturnType<typeof setInterval> | undefined
  let channel: BroadcastChannel | null = null

  function finish(data?: OAuthCallbackData) {
    if (completed) return

    completed = true
    window.removeEventListener('message', handleMessage)
    if (channel) {
      channel.close()
      channel = null
    }
    if (checkClosed) clearInterval(checkClosed)

    callback(data)
  }

  function handleMessage(event: MessageEvent) {
    if (event.data?.type === OAUTH_CALLBACK_MESSAGE_TYPE) finish(event.data)
  }

  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(OAUTH_CALLBACK_CHANNEL_NAME)
    channel.onmessage = (event: MessageEvent<OAuthCallbackData>) => {
      if (event.data?.type === OAUTH_CALLBACK_MESSAGE_TYPE) finish(event.data)
    }
  }

  window.addEventListener('message', handleMessage)

  checkClosed = setInterval(() => {
    if (popup?.closed) finish()
  }, 1000)

  return popup
}
