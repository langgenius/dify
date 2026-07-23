import type { DeploymentEdition } from '@dify/contracts/api/console/system-features/types.gen'

type ConversationField = {
  id: string
  value: unknown
}

declare global {
  // oxlint-disable-next-line typescript/consistent-type-definitions
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
  deploymentEdition: DeploymentEdition | null,
  callback?: () => unknown,
) => {
  if (deploymentEdition === 'CLOUD' && window.zE)
    window.zE('messenger:set', 'conversationFields', fields, callback)
}

type OpenZendeskWindowOptions = {
  interval?: number
  retries?: number
}

const openZendeskWindowOnce = (deploymentEdition: DeploymentEdition | null) => {
  if (deploymentEdition !== 'CLOUD' || !window.zE) return false

  window.zE('messenger', 'show')
  window.zE('messenger', 'open')
  return true
}

export const openZendeskWindow = (
  deploymentEdition: DeploymentEdition | null,
  { interval = 100, retries = 20 }: OpenZendeskWindowOptions = {},
) => {
  if (deploymentEdition !== 'CLOUD') return

  if (openZendeskWindowOnce(deploymentEdition)) return

  let attempts = 0
  const timer = window.setInterval(() => {
    attempts += 1
    if (openZendeskWindowOnce(deploymentEdition) || attempts >= retries) window.clearInterval(timer)
  }, interval)
}
