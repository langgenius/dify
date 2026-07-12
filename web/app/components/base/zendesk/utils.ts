import { IS_CE_EDITION } from '@/config'

type ConversationField = {
  id: string
  value: unknown
}

declare global {
  // eslint-disable-next-line ts/consistent-type-definitions
  interface Window {
    zE?: (
      command: string,
      value: string,
      payload?: ConversationField[] | string | string[] | (() => unknown),
      callback?: () => unknown,
    ) => void
  }
}

export const setZendeskConversationFields = (
  fields: ConversationField[],
  callback?: () => unknown,
) => {
  if (!IS_CE_EDITION && window.zE)
    window.zE('messenger:set', 'conversationFields', fields, callback)
}

type OpenZendeskWindowOptions = {
  interval?: number
  retries?: number
}

const openZendeskWindowOnce = () => {
  if (IS_CE_EDITION || !window.zE) return false

  window.zE('messenger', 'show')
  window.zE('messenger', 'open')
  return true
}

export const openZendeskWindow = ({
  interval = 100,
  retries = 20,
}: OpenZendeskWindowOptions = {}) => {
  if (IS_CE_EDITION) return

  if (openZendeskWindowOnce()) return

  let attempts = 0
  const timer = window.setInterval(() => {
    attempts += 1
    if (openZendeskWindowOnce() || attempts >= retries) window.clearInterval(timer)
  }, interval)
}
